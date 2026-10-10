// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AssetStatus,
    OfferingStatus,
    OfferingView,
    IArchpropRegistry,
    IIdentityRegistry,
    IOfferingEscrow,
    IPropertyToken
} from "./ArchpropInterfaces.sol";

/**
 * @title OfferingEscrow
 * @notice Escrows investor payment tokens during an offering and releases either
 *         property tokens (on success) or refunds (on failure).
 *
 * @dev Invariants:
 *      - Only an `ISSUANCE_READY` asset whose token is registered in the
 *        registry may get an offering.
 *      - `target` must equal `propertyToken.totalSupply() * tokenPrice`, so the
 *        offering always sells the entire fixed supply.
 *      - Only `IdentityRegistry`-approved investors may invest, and only in
 *        whole tokens (`paymentAmount % tokenPrice == 0`) without exceeding the
 *        target.
 *      - Payment tokens stay escrowed until successful finalization *and*
 *        release; the issuer cannot touch funds earlier.
 *      - A failed offering permits refunds only; a funded offering permits token
 *        claims only. Every claim and release path is one-time and
 *        non-reentrant.
 */
contract OfferingEscrow is AccessControl, ReentrancyGuard, IOfferingEscrow {
    using SafeERC20 for IERC20;

    bytes32 public constant STRUCTURER_ROLE = keccak256("STRUCTURER_ROLE");

    IArchpropRegistry public immutable registry;
    IIdentityRegistry public immutable identityRegistry;

    struct Offering {
        bytes32 assetId;
        address propertyToken;
        address paymentToken;
        uint256 target;
        uint256 tokenPrice;
        uint64 deadline;
        uint256 raised;
        address issuerTreasury;
        OfferingStatus status;
        bool fundsReleased;
    }

    uint256 public offeringCount;

    mapping(uint256 => Offering) private _offerings;
    mapping(uint256 => mapping(address => uint256)) private _allocation;
    mapping(uint256 => mapping(address => uint256)) private _payment;
    mapping(uint256 => mapping(address => bool)) private _tokensClaimed;
    mapping(uint256 => mapping(address => bool)) private _refundClaimed;
    /// @dev One open offering per asset token, enforced at creation.
    mapping(address => uint256) public offeringIdByToken;

    event OfferingCreated(
        uint256 indexed offeringId,
        bytes32 indexed assetId,
        address indexed token,
        uint256 target,
        uint256 tokenPrice,
        uint64 deadline
    );
    event InvestmentMade(
        uint256 indexed offeringId,
        address indexed investor,
        uint256 paymentAmount,
        uint256 allocation
    );
    event OfferingFunded(uint256 indexed offeringId, uint256 raised);
    event OfferingFailed(uint256 indexed offeringId, uint256 raised);
    event TokensClaimed(uint256 indexed offeringId, address indexed investor, uint256 allocation);
    event RefundClaimed(uint256 indexed offeringId, address indexed investor, uint256 amount);
    event FundsReleased(uint256 indexed offeringId, address indexed treasury, uint256 amount);

    error ZeroAddress();
    error OfferingNotFound();
    error OfferingAlreadyExistsForToken();
    error AssetNotIssuanceReady();
    error TokenNotLinkedInRegistry();
    error RegistryAssetMismatch();
    error TokenIdentityRegistryMismatch(address expected, address actual);
    error TokenEscrowMismatch(address expected, address actual);
    error InvalidDeadline();
    error InvalidTreasury();
    error InvalidTarget();
    error TokenPriceMismatch();
    error NotApprovedInvestor(address investor);
    error ZeroInvestment();
    error NotWholeTokenAmount(uint256 paymentAmount, uint256 tokenPrice);
    error OfferingFull(uint256 remaining);
    error AmountMismatch(uint256 expected, uint256 received);
    error InvalidOfferingStatus(OfferingStatus current);
    error DeadlineNotPassed();
    error DeadlinePassed();
    error TargetNotReached(uint256 raised, uint256 target);
    error NothingToClaim();
    error RefundNotAvailable();
    error TokenClaimNotAvailable();
    error FundsAlreadyReleased();

    constructor(address admin, address registry_, address identityRegistry_) {
        if (admin == address(0) || registry_ == address(0) || identityRegistry_ == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = IArchpropRegistry(registry_);
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    // ---------------------------------------------------------------------
    // Offering creation
    // ---------------------------------------------------------------------

    /**
     * @notice Creates an offering and moves the asset `ISSUANCE_READY -> OFFERING`.
     * @dev Validates the registry-linked token, the issuance-ready status, a
     *      future deadline, a nonzero treasury and `target == supply * price`.
     *
     *      Minting is not performed here. `PropertyToken`'s constructor already
     *      minted the entire fixed supply to this escrow, which is why
     *      `target` must equal `totalSupply() * tokenPrice` and why the escrow's
     *      own token balance must still equal the supply at creation.
     *
     *      Token wiring is verified against this deployment: the token's
     *      `identityRegistry` must be the one this escrow consults, and its
     *      `offeringEscrow` must be this contract. A token minted to a different
     *      escrow, or one whose investor gate differs from ours, is rejected.
     */
    function createOffering(
        bytes32 assetId,
        address propertyToken,
        address paymentToken,
        uint256 target,
        uint256 tokenPrice,
        uint64 deadline,
        address issuerTreasury
    ) external onlyRole(STRUCTURER_ROLE) nonReentrant returns (uint256 offeringId) {
        if (assetId == bytes32(0) || propertyToken == address(0) || paymentToken == address(0)) {
            revert ZeroAddress();
        }
        if (issuerTreasury == address(0)) revert InvalidTreasury();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (tokenPrice == 0) revert TokenPriceMismatch();
        if (target == 0) revert InvalidTarget();
        if (offeringIdByToken[propertyToken] != 0) revert OfferingAlreadyExistsForToken();

        if (registry.assetStatus(assetId) != AssetStatus.ISSUANCE_READY) {
            revert AssetNotIssuanceReady();
        }
        if (registry.assetToken(assetId) != propertyToken) revert TokenNotLinkedInRegistry();
        if (IPropertyToken(propertyToken).assetId() != assetId) revert RegistryAssetMismatch();

        // The token must gate investors through the same registry this escrow
        // uses, and must have been minted to this escrow and no other.
        IPropertyToken token = IPropertyToken(propertyToken);
        if (token.identityRegistry() != address(identityRegistry)) {
            revert TokenIdentityRegistryMismatch(
                address(identityRegistry), token.identityRegistry()
            );
        }
        if (token.offeringEscrow() != address(this)) {
            revert TokenEscrowMismatch(address(this), token.offeringEscrow());
        }

        uint256 supply = IERC20(propertyToken).totalSupply();
        if (target != supply * tokenPrice) revert InvalidTarget();

        offeringId = ++offeringCount;
        _offerings[offeringId] = Offering({
            assetId: assetId,
            propertyToken: propertyToken,
            paymentToken: paymentToken,
            target: target,
            tokenPrice: tokenPrice,
            deadline: deadline,
            raised: 0,
            issuerTreasury: issuerTreasury,
            status: OfferingStatus.OPEN,
            fundsReleased: false
        });
        offeringIdByToken[propertyToken] = offeringId;

        // The token's entire fixed supply was minted to this escrow at
        // construction; confirm nothing else holds it yet.
        if (IERC20(propertyToken).balanceOf(address(this)) != supply) revert InvalidTarget();

        registry.transitionFromEscrow(assetId, AssetStatus.OFFERING);

        emit OfferingCreated(offeringId, assetId, propertyToken, target, tokenPrice, deadline);
    }

    // ---------------------------------------------------------------------
    // Investment
    // ---------------------------------------------------------------------

    /// @notice Escrows `paymentAmount` and credits whole-token allocation.
    function invest(uint256 offeringId, uint256 paymentAmount) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (!identityRegistry.isApproved(msg.sender)) revert NotApprovedInvestor(msg.sender);
        if (paymentAmount == 0) revert ZeroInvestment();
        if (o.status != OfferingStatus.OPEN) revert InvalidOfferingStatus(o.status);
        if (block.timestamp >= o.deadline) revert DeadlinePassed();
        if (paymentAmount % o.tokenPrice != 0) {
            revert NotWholeTokenAmount(paymentAmount, o.tokenPrice);
        }

        uint256 remaining = o.target - o.raised;
        if (paymentAmount > remaining) revert OfferingFull(remaining);

        // Pull payment and verify exact deposit before crediting accounting state.
        uint256 balanceBefore = IERC20(o.paymentToken).balanceOf(address(this));
        IERC20(o.paymentToken).safeTransferFrom(msg.sender, address(this), paymentAmount);
        uint256 received = IERC20(o.paymentToken).balanceOf(address(this)) - balanceBefore;
        if (received != paymentAmount) revert AmountMismatch(paymentAmount, received);

        uint256 allocation = paymentAmount / o.tokenPrice;
        _payment[offeringId][msg.sender] += paymentAmount;
        _allocation[offeringId][msg.sender] += allocation;
        o.raised += paymentAmount;

        emit InvestmentMade(offeringId, msg.sender, paymentAmount, allocation);
    }

    // ---------------------------------------------------------------------
    // Finalization
    // ---------------------------------------------------------------------

    /**
     * @notice Finalizes a fully-funded offering: `FUNDED` on-chain, tokens
     *         claimable by investors, funds claimable by the issuer.
     */
    function finalizeSuccessfulOffering(uint256 offeringId) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (o.status != OfferingStatus.OPEN) revert InvalidOfferingStatus(o.status);
        if (o.raised < o.target) revert TargetNotReached(o.raised, o.target);

        o.status = OfferingStatus.FUNDED;
        registry.transitionFromEscrow(o.assetId, AssetStatus.FUNDED);

        emit OfferingFunded(offeringId, o.raised);
    }

    /**
     * @notice Fails an offering whose deadline passed below target. Refunds
     *         become available; funds can never be released.
     */
    function failOffering(uint256 offeringId) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (o.status != OfferingStatus.OPEN) revert InvalidOfferingStatus(o.status);
        if (block.timestamp < o.deadline) revert DeadlineNotPassed();
        if (o.raised >= o.target) revert TargetNotReached(o.raised, o.target);

        o.status = OfferingStatus.FAILED;
        registry.transitionFromEscrow(o.assetId, AssetStatus.FAILED);

        emit OfferingFailed(offeringId, o.raised);
    }

    /**
     * @notice Releases escrowed payment tokens to the issuer treasury and
     *         activates the asset in the same transaction.
     * @dev Funded offerings only, one-time. This is the sole path to `ACTIVE`,
     *      which is what gates revenue publication, so the issuer can never hold
     *      the funds while the asset remains unactivated.
     */
    function releaseFunds(uint256 offeringId) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (o.status != OfferingStatus.FUNDED) revert InvalidOfferingStatus(o.status);
        if (o.fundsReleased) revert FundsAlreadyReleased();

        uint256 balanceBefore = IERC20(o.paymentToken).balanceOf(o.issuerTreasury);
        IERC20(o.paymentToken).safeTransfer(o.issuerTreasury, o.raised);
        uint256 received = IERC20(o.paymentToken).balanceOf(o.issuerTreasury) - balanceBefore;
        if (received != o.raised) revert AmountMismatch(o.raised, received);

        o.fundsReleased = true;
        registry.transitionFromEscrow(o.assetId, AssetStatus.ACTIVE);

        emit FundsReleased(offeringId, o.issuerTreasury, o.raised);
    }

    // ---------------------------------------------------------------------
    // Claims
    // ---------------------------------------------------------------------

    /// @notice Claims property tokens. Funded offerings only, one-time.
    function claimTokens(uint256 offeringId) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (o.status != OfferingStatus.FUNDED) revert TokenClaimNotAvailable();
        if (_tokensClaimed[offeringId][msg.sender]) revert NothingToClaim();

        uint256 allocation = _allocation[offeringId][msg.sender];
        if (allocation == 0) revert NothingToClaim();

        _tokensClaimed[offeringId][msg.sender] = true;
        IERC20(o.propertyToken).safeTransfer(msg.sender, allocation);

        emit TokensClaimed(offeringId, msg.sender, allocation);
    }

    /// @notice Claims a payment-token refund. Failed offerings only, one-time.
    function claimRefund(uint256 offeringId) external nonReentrant {
        Offering storage o = _requireOffering(offeringId);
        if (o.status != OfferingStatus.FAILED) revert RefundNotAvailable();
        if (_refundClaimed[offeringId][msg.sender]) revert NothingToClaim();

        uint256 amount = _payment[offeringId][msg.sender];
        if (amount == 0) revert NothingToClaim();

        uint256 balanceBefore = IERC20(o.paymentToken).balanceOf(msg.sender);
        IERC20(o.paymentToken).safeTransfer(msg.sender, amount);
        uint256 received = IERC20(o.paymentToken).balanceOf(msg.sender) - balanceBefore;
        if (received != amount) revert AmountMismatch(amount, received);

        _refundClaimed[offeringId][msg.sender] = true;

        emit RefundClaimed(offeringId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getOffering(uint256 offeringId) external view returns (OfferingView memory) {
        Offering storage o = _offerings[offeringId];
        return OfferingView({
            assetId: o.assetId,
            propertyToken: o.propertyToken,
            paymentToken: o.paymentToken,
            target: o.target,
            tokenPrice: o.tokenPrice,
            deadline: o.deadline,
            raised: o.raised,
            issuerTreasury: o.issuerTreasury,
            status: o.status,
            fundsReleased: o.fundsReleased
        });
    }

    function allocationOf(uint256 offeringId, address investor) external view returns (uint256) {
        return _allocation[offeringId][investor];
    }

    function paymentOf(uint256 offeringId, address investor) external view returns (uint256) {
        return _payment[offeringId][investor];
    }

    function tokensClaimed(uint256 offeringId, address investor) external view returns (bool) {
        return _tokensClaimed[offeringId][investor];
    }

    function refundClaimed(uint256 offeringId, address investor) external view returns (bool) {
        return _refundClaimed[offeringId][investor];
    }

    function remainingCapacity(uint256 offeringId) external view returns (uint256) {
        Offering storage o = _offerings[offeringId];
        return o.target - o.raised;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _requireOffering(uint256 offeringId) private view returns (Offering storage o) {
        if (offeringId == 0 || offeringId > offeringCount) revert OfferingNotFound();
        o = _offerings[offeringId];
    }
}
