// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    RevenueEpochView,
    IArchpropRegistry,
    IPropertyToken,
    IRevenueDistributor
} from "./ArchpropInterfaces.sol";

/**
 * @title RevenueDistributor
 * @notice Pro-rata revenue distribution for one property token per epoch.
 *
 * @dev Publishing a revenue epoch:
 *      - requires a matching valid `REVENUE` attestation (checked through the
 *        registry, including the `ACTIVE` asset status);
 *      - requires an exact `safeTransferFrom` deposit in the same transaction;
 *      - consumes the attestation evidence hash, so it is single-use;
 *      - permits only one open epoch per property token;
 *      - requires that the offering escrow hold no remaining property tokens,
 *        so every unit of supply belongs to an investor;
 *      - locks property-token transfers for the duration of the epoch.
 *
 *      A claim is `balanceOf(claimant) * epoch.amount / epoch.totalSupply` while
 *      locked, so the aggregate entitlement can never exceed the funded amount;
 *      rounding dust stays in the distributor. Transfers unlock only when an
 *      admin closes the epoch after its deadline, claims are unavailable after
 *      closure, and the remaining dust returns to the epoch funder.
 */
contract RevenueDistributor is AccessControl, ReentrancyGuard, IRevenueDistributor {
    using SafeERC20 for IERC20;

    IArchpropRegistry public immutable registry;

    struct RevenueEpoch {
        bytes32 assetId;
        address propertyToken;
        address paymentToken;
        uint256 amount;
        uint256 totalSupply;
        uint64 claimDeadline;
        address funder;
        uint256 claimedAmount;
        bool closed;
    }

    uint256 public epochCount;

    mapping(uint256 => RevenueEpoch) private _epochs;
    mapping(uint256 => mapping(address => bool)) private _claimed;
    /// @dev Single-use guard per (propertyToken, evidenceHash) pair.
    mapping(address => mapping(bytes32 => bool)) public evidenceHashUsed;
    /// @dev The currently open (unclosed) epoch for a token, if any.
    mapping(address => uint256) public openEpochByToken;

    event RevenuePublished(
        uint256 indexed epochId,
        bytes32 indexed assetId,
        uint256 amount,
        bytes32 evidenceHash,
        uint64 claimDeadline
    );
    event RevenueClaimed(uint256 indexed epochId, address indexed investor, uint256 amount);
    event RevenueEpochClosed(uint256 indexed epochId, address indexed funder, uint256 dust);

    error ZeroAddress();
    error EpochNotFound();
    error RevenueAttestationInvalid();
    error EvidenceHashAlreadyUsed(bytes32 evidenceHash);
    error OpenEpochExists(uint256 epochId);
    error TokenNotLinkedToAsset();
    error TokenRevenueDistributorMismatch(address expected, address actual);
    error EscrowHoldsTokens(uint256 remaining);
    error InvalidDeadline();
    error AmountMismatch(uint256 expected, uint256 received);
    error EpochClosed();
    error DeadlineNotPassed();
    error NothingToClaim();
    error AlreadyClaimed();

    constructor(address admin, address registry_) {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = IArchpropRegistry(registry_);
    }

    /**
     * @notice Funds and opens a revenue epoch for `propertyToken`.
     * @dev Pulls exactly `amount` of `paymentToken` from the caller and locks
     *      transfers on the property token. The `DEFAULT_ADMIN_ROLE` is the
     *      authorized demo publisher; the attestation itself carries the
     *      economic proof, so publication authority and attestation are separate
     *      duties.
     */
    function publishRevenue(
        bytes32 assetId,
        address propertyToken,
        address paymentToken,
        uint256 amount,
        bytes32 evidenceHash,
        uint64 claimDeadline
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 epochId) {
        if (
            assetId == bytes32(0) || propertyToken == address(0) || paymentToken == address(0)
                || evidenceHash == bytes32(0)
        ) revert ZeroAddress();
        if (amount == 0) revert RevenueAttestationInvalid();
        if (claimDeadline <= block.timestamp) revert InvalidDeadline();

        // The token must be the one the registry linked to this asset.
        if (registry.assetToken(assetId) != propertyToken) revert TokenNotLinkedToAsset();

        // The token must report this distributor, otherwise it would never
        // honour the transfer lock this contract sets on it.
        IPropertyToken token = IPropertyToken(propertyToken);
        if (token.revenueDistributor() != address(this)) {
            revert TokenRevenueDistributorMismatch(address(this), token.revenueDistributor());
        }

        // Matching valid REVENUE attestation; the asset must be ACTIVE.
        if (!registry.isRevenueAttestationValid(assetId, evidenceHash, amount)) {
            revert RevenueAttestationInvalid();
        }

        // Single-use evidence hash.
        if (evidenceHashUsed[propertyToken][evidenceHash]) {
            revert EvidenceHashAlreadyUsed(evidenceHash);
        }

        // Only one open epoch per property token.
        uint256 existing = openEpochByToken[propertyToken];
        if (existing != 0 && !_epochs[existing].closed) revert OpenEpochExists(existing);

        // The escrow must hold no remaining property tokens, otherwise some
        // supply is not owned by an investor and the pro-rata split would be wrong.
        uint256 remainingInEscrow =
            IERC20(propertyToken).balanceOf(IPropertyToken(propertyToken).offeringEscrow());
        if (remainingInEscrow != 0) revert EscrowHoldsTokens(remainingInEscrow);

        uint256 supply = IERC20(propertyToken).totalSupply();

        // Pull the exact deposit in this transaction.
        uint256 balanceBefore = IERC20(paymentToken).balanceOf(address(this));
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(paymentToken).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert AmountMismatch(amount, received);

        evidenceHashUsed[propertyToken][evidenceHash] = true;

        epochId = ++epochCount;
        _epochs[epochId] = RevenueEpoch({
            assetId: assetId,
            propertyToken: propertyToken,
            paymentToken: paymentToken,
            amount: amount,
            totalSupply: supply,
            claimDeadline: claimDeadline,
            funder: msg.sender,
            claimedAmount: 0,
            closed: false
        });
        openEpochByToken[propertyToken] = epochId;

        IPropertyToken(propertyToken).setRevenueTransferLock(true);

        emit RevenuePublished(epochId, assetId, amount, evidenceHash, claimDeadline);
    }

    /**
     * @notice Claims a pro-rata share of a revenue epoch.
     * @dev `balanceOf(claimant) * amount / totalSupply` while transfers are
     *      locked. One-time per epoch per claimant.
     */
    function claimRevenue(uint256 epochId) external nonReentrant {
        RevenueEpoch storage e = _requireEpoch(epochId);
        if (e.closed) revert EpochClosed();
        if (block.timestamp > e.claimDeadline) revert DeadlineNotPassed();
        if (_claimed[epochId][msg.sender]) revert AlreadyClaimed();

        uint256 balance = IERC20(e.propertyToken).balanceOf(msg.sender);
        if (balance == 0) revert NothingToClaim();

        uint256 entitlement = (balance * e.amount) / e.totalSupply;
        if (entitlement == 0) revert NothingToClaim();

        uint256 balanceBefore = IERC20(e.paymentToken).balanceOf(msg.sender);
        IERC20(e.paymentToken).safeTransfer(msg.sender, entitlement);
        uint256 received = IERC20(e.paymentToken).balanceOf(msg.sender) - balanceBefore;
        if (received != entitlement) revert AmountMismatch(entitlement, received);

        _claimed[epochId][msg.sender] = true;
        e.claimedAmount += entitlement;

        emit RevenueClaimed(epochId, msg.sender, entitlement);
    }

    /**
     * @notice Closes an epoch after its deadline: unlocks transfers, returns the
     *         unclaimed dust to the funder, and disables further claims.
     */
    function closeRevenueEpoch(uint256 epochId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        RevenueEpoch storage e = _requireEpoch(epochId);
        if (e.closed) revert EpochClosed();
        if (block.timestamp <= e.claimDeadline) revert DeadlineNotPassed();

        uint256 dust = e.amount - e.claimedAmount;

        if (dust > 0) {
            uint256 balanceBefore = IERC20(e.paymentToken).balanceOf(e.funder);
            IERC20(e.paymentToken).safeTransfer(e.funder, dust);
            uint256 received = IERC20(e.paymentToken).balanceOf(e.funder) - balanceBefore;
            if (received != dust) revert AmountMismatch(dust, received);
        }

        e.closed = true;
        IPropertyToken(e.propertyToken).setRevenueTransferLock(false);

        emit RevenueEpochClosed(epochId, e.funder, dust);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRevenueEpoch(uint256 epochId) external view returns (RevenueEpochView memory) {
        RevenueEpoch storage e = _epochs[epochId];
        return RevenueEpochView({
            assetId: e.assetId,
            propertyToken: e.propertyToken,
            paymentToken: e.paymentToken,
            amount: e.amount,
            totalSupply: e.totalSupply,
            claimDeadline: e.claimDeadline,
            funder: e.funder,
            claimedAmount: e.claimedAmount,
            closed: e.closed
        });
    }

    /**
     * @notice Pro-rata revenue an `investor` can still claim from `epochId`.
     * @dev Reverts with `EpochNotFound` for an unknown epoch, since a caller
     *      asking about a nonexistent epoch is reporting a bug rather than a
     *      legitimate zero entitlement. Returns zero — without reverting — for
     *      every state where nothing is claimable: a closed epoch, an epoch
     *      past its deadline, an investor who already claimed, and an investor
     *      holding no tokens.
     */
    function claimableRevenue(uint256 epochId, address investor) external view returns (uint256) {
        RevenueEpoch storage e = _requireEpoch(epochId);
        if (e.closed || _claimed[epochId][investor] || block.timestamp > e.claimDeadline) return 0;
        uint256 balance = IERC20(e.propertyToken).balanceOf(investor);
        if (balance == 0) return 0;
        return (balance * e.amount) / e.totalSupply;
    }

    function revenueClaimed(uint256 epochId, address investor) external view returns (bool) {
        return _claimed[epochId][investor];
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _requireEpoch(uint256 epochId) private view returns (RevenueEpoch storage e) {
        if (epochId == 0 || epochId > epochCount) revert EpochNotFound();
        e = _epochs[epochId];
    }
}
