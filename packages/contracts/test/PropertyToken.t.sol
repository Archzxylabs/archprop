// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AttestationType} from "../src/ArchpropInterfaces.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title PropertyTokenTest
 * @notice Covers the fixed-supply invariant and the transfer policy:
 *         escrow transfers always allowed, everything else requires approval.
 */
contract PropertyTokenTest is BaseTest {
    PropertyToken internal token;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
    }

    // -----------------------------------------------------------------
    // construction / supply
    // -----------------------------------------------------------------

    function test_construction_mintsFixedSupplyToEscrowOnce() public {
        assertEq(token.totalSupply(), TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(escrow)), TOKEN_SUPPLY);
        assertEq(token.decimals(), 0);
        assertEq(token.name(), TOKEN_NAME);
        assertEq(token.symbol(), TOKEN_SYMBOL);
        assertEq(token.assetId(), assetId);
        assertEq(token.offeringEscrow(), address(escrow));
        assertEq(token.revenueDistributor(), address(distributor));
    }

    function test_supplyIsFixedAcrossTheWholeLifecycle() public {
        // The constructor mint is the only mint that exists, so the supply
        // cannot move — not through issuance, claims, secondary transfers or
        // asset activation.
        uint256 offeringId = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(offeringId);

        assertEq(token.totalSupply(), TOKEN_SUPPLY);
        assertEq(token.balanceOf(investor1), TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(escrow)), 0);

        // A secondary-market transfer between approved investors.
        vm.prank(investor1);
        token.transfer(investor2, 1_000);
        assertEq(token.totalSupply(), TOKEN_SUPPLY);

        escrow.releaseFunds(offeringId);
        assertEq(token.totalSupply(), TOKEN_SUPPLY);
    }

    function test_construction_rejectsZeroDependencies() public {
        vm.expectRevert(PropertyToken.ZeroAddress.selector);
        new PropertyToken(
            "Bad", "BAD", assetId, TOKEN_SUPPLY, address(0), address(escrow), address(distributor)
        );

        vm.expectRevert(PropertyToken.ZeroAddress.selector);
        new PropertyToken(
            "Bad", "BAD", assetId, TOKEN_SUPPLY, address(identity), address(0), address(distributor)
        );

        vm.expectRevert(PropertyToken.ZeroAddress.selector);
        new PropertyToken(
            "Bad", "BAD", assetId, TOKEN_SUPPLY, address(identity), address(escrow), address(0)
        );

        vm.expectRevert(PropertyToken.ZeroAddress.selector);
        new PropertyToken(
            "Bad", "BAD", assetId, 0, address(identity), address(escrow), address(distributor)
        );
    }

    // -----------------------------------------------------------------
    // transfer policy
    // -----------------------------------------------------------------

    function test_escrowTransferToUnapprovedInvestorIsAllowed() public {
        // Ensure `outsider` is definitely not approved.
        vm.prank(admin);
        identity.setInvestorApproval(outsider, false);

        // The escrow still holds the whole supply at this point, so a transfer
        // out of it is allowed without re-checking the recipient.
        vm.prank(address(escrow));
        token.transfer(outsider, 1);

        assertEq(token.balanceOf(outsider), 1);
        assertEq(token.balanceOf(address(escrow)), TOKEN_SUPPLY - 1);
    }

    function test_transferToUnapprovedIsRejected() public {
        _claimAllTokens(token);

        vm.prank(investor1);
        vm.expectRevert(
            abi.encodeWithSelector(PropertyToken.RecipientNotApproved.selector, outsider)
        );
        token.transfer(outsider, 10);
    }

    function test_approvedToApprovedTransferSucceeds() public {
        _claimAllTokens(token);

        vm.prank(investor1);
        token.transfer(investor2, 40);

        assertEq(token.balanceOf(investor1), TOKEN_SUPPLY - 40);
        assertEq(token.balanceOf(investor2), 40);
    }

    // -----------------------------------------------------------------
    // revenue transfer lock
    // -----------------------------------------------------------------

    function test_setRevenueTransferLock_onlyDistributor() public {
        vm.prank(outsider);
        vm.expectRevert(PropertyToken.NotRevenueDistributor.selector);
        token.setRevenueTransferLock(true);

        vm.prank(address(distributor));
        token.setRevenueTransferLock(true);
        assertTrue(token.revenueTransferLocked());

        vm.prank(address(distributor));
        token.setRevenueTransferLock(false);
        assertFalse(token.revenueTransferLocked());
    }

    function test_transfersFrozenWhileRevenueEpochOpen() public {
        uint256 id = _fundedClaimedActive();

        _publishRevenue(5000);

        assertTrue(token.revenueTransferLocked());

        // Even an approved-to-approved transfer is frozen.
        vm.prank(investor1);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transfer(investor2, 10);

        // Closing the epoch unfreezes transfers.
        vm.warp(block.timestamp + 4 days);
        vm.prank(admin);
        distributor.closeRevenueEpoch(id);

        assertFalse(token.revenueTransferLocked());
        vm.prank(investor1);
        token.transfer(investor2, 10);
        assertEq(token.balanceOf(investor2), 10);
    }

    function test_cannotPublishSecondEpochWhileOneIsOpen() public {
        uint256 id = _fundedClaimedActive();
        _publishRevenue(5000);

        bytes32 otherEvidence = keccak256("revenue-2");
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, otherEvidence, 7000);

        vm.startPrank(admin);
        midr.faucet(7000);
        midr.approve(address(distributor), 7000);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.OpenEpochExists.selector, id));
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            7000,
            otherEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    /// @dev Full lifecycle to ACTIVE, with all tokens claimed by investor1.
    function _fundedClaimedActive() internal returns (uint256) {
        uint256 id = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(id);
        escrow.releaseFunds(id);
        return id;
    }

    /// @dev Same, but without releasing funds, for token-transfer assertions.
    function _claimAllTokens(PropertyToken t) internal returns (uint256) {
        uint256 id = _createFundedOffering(t);
        vm.prank(investor1);
        escrow.claimTokens(id);
        return id;
    }

    function _publishRevenue(uint256 amount) internal returns (uint256) {
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, amount);

        vm.startPrank(admin);
        midr.faucet(amount);
        midr.approve(address(distributor), amount);
        uint256 epochId = distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            amount,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
        return epochId;
    }
}
