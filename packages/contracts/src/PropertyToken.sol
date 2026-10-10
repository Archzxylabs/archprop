// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPropertyToken} from "./ArchpropInterfaces.sol";
import {IIdentityRegistry} from "./ArchpropInterfaces.sol";

/**
 * @title PropertyToken
 * @notice Fractional economic-rights token for one verified asset.
 *
 * @dev Fixed supply, zero decimals. The entire supply is minted to the
 *      configured `OfferingEscrow` in the constructor and there is no other
 *      mint path, so `ERC20.totalSupply()` is the single source of truth for
 *      the fixed supply and cannot diverge from any secondary counter.
 *
 *      Transfer rules (`_update` override):
 *      - mints and burns are internal-only, so they never hit this guard;
 *      - transfers where the escrow is sender or recipient are allowed
 *        (issuance to investors and investor claims);
 *      - while `revenueTransferLocked` is set, transfers are frozen entirely so
 *        revenue entitlements cannot move mid-epoch;
 *      - every other transfer requires both parties to be approved in
 *        `IdentityRegistry`.
 */
contract PropertyToken is ERC20, IPropertyToken {
    bytes32 public immutable assetId;
    address public immutable identityRegistry;
    address public immutable offeringEscrow;
    address public immutable revenueDistributor;

    bool public revenueTransferLocked;

    event RevenueTransferLockChanged(bool locked);

    error ZeroAddress();
    error NotRevenueDistributor();
    error TransfersLockedForRevenue();
    error SenderNotApproved(address sender);
    error RecipientNotApproved(address recipient);

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        uint256 supply_,
        address identityRegistry_,
        address offeringEscrow_,
        address revenueDistributor_
    ) ERC20(name_, symbol_) {
        if (
            assetId_ == bytes32(0) || identityRegistry_ == address(0)
                || offeringEscrow_ == address(0) || revenueDistributor_ == address(0)
        ) revert ZeroAddress();
        if (supply_ == 0) revert ZeroAddress();

        assetId = assetId_;
        identityRegistry = identityRegistry_;
        offeringEscrow = offeringEscrow_;
        revenueDistributor = revenueDistributor_;

        // The entire fixed supply is minted once, at construction, straight to
        // the escrow that will distribute it to investors. There is no other
        // mint path anywhere in this contract.
        _mint(offeringEscrow_, supply_);
    }

    /// @dev Whole-token economics: this token has no decimal places.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Freezes or unfreezes transfers. Only the revenue distributor.
    function setRevenueTransferLock(bool locked) external {
        if (msg.sender != revenueDistributor) revert NotRevenueDistributor();
        revenueTransferLocked = locked;
        emit RevenueTransferLockChanged(locked);
    }

    /**
     * @dev Enforcement point for the whole transfer policy.
     *
     *      While a revenue epoch is open, transfers are frozen outright.
     *      Otherwise, transfers to or from the configured escrow are always
     *      allowed (issuance and investor claims); all other transfers require
     *      both parties to be approved investors.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (revenueTransferLocked) {
            // Mint/burn go through `from == address(0)` / `to == address(0)` and
            // can never happen here, because the only mint is the constructor's
            // and this contract defines no burn.
            if (from != address(0) && to != address(0)) revert TransfersLockedForRevenue();
        }

        if (
            from != address(0) && from != offeringEscrow && to != address(0) && to != offeringEscrow
        ) {
            if (!IIdentityRegistry(identityRegistry).isApproved(from)) {
                revert SenderNotApproved(from);
            }
            if (!IIdentityRegistry(identityRegistry).isApproved(to)) {
                revert RecipientNotApproved(to);
            }
        }

        super._update(from, to, value);
    }
}
