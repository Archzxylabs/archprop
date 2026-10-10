// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetStatus, AttestationType, OfferingStatus} from "../src/ArchpropInterfaces.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";
import {BaseTest} from "./Base.t.sol";
import {MockFeeToken} from "./MockFeeToken.sol";

/**
 * @title ExactOutgoingPayoutsTest
 * @notice Tests ADR-015: Outgoing economic transfers must reach their recipients exactly.
 *         Verifies that:
 *         1. OfferingEscrow.claimRefund verifies the investor's balance increases by exactly the refund amount.
 *         2. OfferingEscrow.releaseFunds verifies the treasury's balance increases by exactly the raised amount.
 *         3. RevenueDistributor.claimRevenue verifies the claimant receives their exact entitlement.
 *         4. RevenueDistributor.closeRevenueEpoch verifies the funder receives the exact dust when dust > 0.
 *         5. In all four cases, short-payment reverts atomically with AmountMismatch, leaves state intact,
 *            and allows a successful retry once the fee is disabled.
 *         6. Canonical MockIDR golden path payout behavior is preserved as a regression baseline.
 */
contract ExactOutgoingPayoutsTest is BaseTest {
    PropertyToken internal token;
    MockFeeToken internal feeToken;
    address internal feeCollector = makeAddr("feeCollector");

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);

        feeToken = new MockFeeToken("Mutable Fee Token", "MFT", 0, feeCollector, false);
    }

    // -------------------------------------------------------------------------
    // 1. OfferingEscrow.claimRefund
    // -------------------------------------------------------------------------

    function test_claimRefund_rejectsShortPayment_rollsBack_andRetriesSuccessfully() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(feeToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 paymentAmount = 50 * TOKEN_PRICE; // 500,000 units
        feeToken.mint(investor1, paymentAmount);

        // Deposit at zero fee succeeds.
        vm.startPrank(investor1);
        feeToken.approve(address(escrow), paymentAmount);
        escrow.invest(offeringId, paymentAmount);
        vm.stopPrank();

        assertEq(feeToken.balanceOf(address(escrow)), paymentAmount);

        // Offering fails.
        vm.warp(deadline + 1);
        escrow.failOffering(offeringId);
        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FAILED));

        // Activate 5% fee before refund payout.
        feeToken.setFeeBps(500);

        uint256 expectedReceived = paymentAmount - (paymentAmount * 500 / 10_000);
        vm.prank(investor1);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.AmountMismatch.selector, paymentAmount, expectedReceived
            )
        );
        escrow.claimRefund(offeringId);

        // Rollback verification: refundClaimed is NOT set, escrow balance is intact.
        assertFalse(escrow.refundClaimed(offeringId, investor1));
        assertEq(feeToken.balanceOf(address(escrow)), paymentAmount);
        assertEq(feeToken.balanceOf(investor1), 0);

        // Disable fee and retry.
        feeToken.setFeeBps(0);

        vm.prank(investor1);
        escrow.claimRefund(offeringId);

        // Successful retry verification.
        assertTrue(escrow.refundClaimed(offeringId, investor1));
        assertEq(feeToken.balanceOf(investor1), paymentAmount);
        assertEq(feeToken.balanceOf(address(escrow)), 0);

        // Further claim attempts fail closed.
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);
    }

    // -------------------------------------------------------------------------
    // 2. OfferingEscrow.releaseFunds
    // -------------------------------------------------------------------------

    function test_releaseFunds_rejectsShortPayment_rollsBack_andRetriesSuccessfully() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(feeToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 half = TARGET / 2;
        feeToken.mint(investor1, half);
        feeToken.mint(investor2, half);

        // Fund offering fully at zero fee.
        vm.startPrank(investor1);
        feeToken.approve(address(escrow), half);
        escrow.invest(offeringId, half);
        vm.stopPrank();

        vm.startPrank(investor2);
        feeToken.approve(address(escrow), half);
        escrow.invest(offeringId, half);
        vm.stopPrank();

        escrow.finalizeSuccessfulOffering(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        // Activate 10% fee before treasury release.
        feeToken.setFeeBps(1000);

        uint256 expectedReceived = TARGET - (TARGET * 1000 / 10_000);
        vm.expectRevert(
            abi.encodeWithSelector(OfferingEscrow.AmountMismatch.selector, TARGET, expectedReceived)
        );
        escrow.releaseFunds(offeringId);

        // Rollback verification: fundsReleased is false, asset remains FUNDED, escrow holds TARGET.
        assertFalse(escrow.getOffering(offeringId).fundsReleased);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));
        assertEq(feeToken.balanceOf(address(escrow)), TARGET);
        assertEq(feeToken.balanceOf(treasury), 0);

        // Disable fee and retry.
        feeToken.setFeeBps(0);

        escrow.releaseFunds(offeringId);

        // Successful retry verification.
        assertTrue(escrow.getOffering(offeringId).fundsReleased);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));
        assertEq(feeToken.balanceOf(treasury), TARGET);
        assertEq(feeToken.balanceOf(address(escrow)), 0);

        // Double release strictly reverts.
        vm.expectRevert(OfferingEscrow.FundsAlreadyReleased.selector);
        escrow.releaseFunds(offeringId);
    }

    // -------------------------------------------------------------------------
    // 3. RevenueDistributor.claimRevenue
    // -------------------------------------------------------------------------

    function test_claimRevenue_rejectsShortPayment_rollsBack_andRetriesSuccessfully() public {
        _activateAssetWithCanonicalToken();

        // Split tokens: investor1 has 200,000 (2/3), investor2 has 100,000 (1/3).
        vm.prank(investor1);
        token.transfer(investor2, 100_000);

        uint256 revenueAmount = 9_000;
        bytes32 evidence = keccak256("revenue-evidence-1");
        uint64 claimDeadline = uint64(block.timestamp + 3 days);

        _attestRevenue(evidence, revenueAmount);

        // Fund revenue at zero fee.
        feeToken.mint(admin, revenueAmount);
        vm.startPrank(admin);
        feeToken.approve(address(distributor), revenueAmount);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(feeToken), revenueAmount, evidence, claimDeadline
        );
        vm.stopPrank();

        assertEq(feeToken.balanceOf(address(distributor)), revenueAmount);

        // Investor 1 entitlement is 200,000 * 9,000 / 300,000 = 6,000.
        uint256 entitlement1 = 6_000;

        // Activate 5% fee before claiming.
        feeToken.setFeeBps(500);

        uint256 expectedReceived = entitlement1 - (entitlement1 * 500 / 10_000);
        vm.prank(investor1);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevenueDistributor.AmountMismatch.selector, entitlement1, expectedReceived
            )
        );
        distributor.claimRevenue(epochId);

        // Rollback verification: claim flag not consumed, claimedAmount 0, distributor holds full revenue.
        assertFalse(distributor.revenueClaimed(epochId, investor1));
        assertEq(distributor.getRevenueEpoch(epochId).claimedAmount, 0);
        assertEq(feeToken.balanceOf(address(distributor)), revenueAmount);
        assertEq(feeToken.balanceOf(investor1), 0);

        // Disable fee and retry.
        feeToken.setFeeBps(0);

        vm.prank(investor1);
        distributor.claimRevenue(epochId);

        // Successful retry verification.
        assertTrue(distributor.revenueClaimed(epochId, investor1));
        assertEq(distributor.getRevenueEpoch(epochId).claimedAmount, entitlement1);
        assertEq(feeToken.balanceOf(investor1), entitlement1);
        assertEq(feeToken.balanceOf(address(distributor)), revenueAmount - entitlement1);

        // Re-claiming strictly reverts.
        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.AlreadyClaimed.selector);
        distributor.claimRevenue(epochId);
    }

    // -------------------------------------------------------------------------
    // 4. RevenueDistributor.closeRevenueEpoch (with nonzero dust)
    // -------------------------------------------------------------------------

    function test_closeRevenueEpoch_rejectsShortPaymentOfDust_rollsBack_andRetriesSuccessfully()
        public
    {
        _activateAssetWithCanonicalToken();

        // Split tokens: investor1 has 150,000 (50%), investor2 has 150,000 (50%).
        vm.prank(investor1);
        token.transfer(investor2, 150_000);

        uint256 revenueAmount = 10_000;
        bytes32 evidence = keccak256("revenue-evidence-dust");
        uint64 claimDeadline = uint64(block.timestamp + 3 days);

        _attestRevenue(evidence, revenueAmount);

        // Fund revenue at zero fee.
        feeToken.mint(admin, revenueAmount);
        vm.startPrank(admin);
        feeToken.approve(address(distributor), revenueAmount);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(feeToken), revenueAmount, evidence, claimDeadline
        );
        vm.stopPrank();

        // Investor 1 claims 5,000 units.
        vm.prank(investor1);
        distributor.claimRevenue(epochId);
        assertEq(feeToken.balanceOf(address(distributor)), 5_000);

        // Investor 2 does NOT claim. Unclaimed dust is 5,000 units (> 0).
        uint256 expectedDust = 5_000;

        // Warp past deadline.
        vm.warp(claimDeadline + 1);

        // Activate 10% fee before closing.
        feeToken.setFeeBps(1000);

        uint256 expectedReceived = expectedDust - (expectedDust * 1000 / 10_000);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevenueDistributor.AmountMismatch.selector, expectedDust, expectedReceived
            )
        );
        distributor.closeRevenueEpoch(epochId);

        // Rollback verification: epoch remains unclosed, lock remains active, distributor holds dust.
        assertFalse(distributor.getRevenueEpoch(epochId).closed);
        assertTrue(token.revenueTransferLocked());
        assertEq(feeToken.balanceOf(address(distributor)), expectedDust);
        assertEq(feeToken.balanceOf(admin), 0);

        // Disable fee and retry.
        feeToken.setFeeBps(0);

        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        // Successful retry verification.
        assertTrue(distributor.getRevenueEpoch(epochId).closed);
        assertFalse(token.revenueTransferLocked());
        assertEq(feeToken.balanceOf(admin), expectedDust);
        assertEq(feeToken.balanceOf(address(distributor)), 0);

        // Double close strictly reverts.
        vm.prank(admin);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.closeRevenueEpoch(epochId);
    }

    // -------------------------------------------------------------------------
    // 5. Zero dust close succeeds without transfer
    // -------------------------------------------------------------------------

    function test_closeRevenueEpoch_zeroDust_succeedsWithoutTransfer() public {
        _activateAssetWithCanonicalToken();

        uint256 revenueAmount = 6_000;
        bytes32 evidence = keccak256("revenue-evidence-zero-dust");
        uint64 claimDeadline = uint64(block.timestamp + 3 days);

        _attestRevenue(evidence, revenueAmount);

        feeToken.mint(admin, revenueAmount);
        vm.startPrank(admin);
        feeToken.approve(address(distributor), revenueAmount);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(feeToken), revenueAmount, evidence, claimDeadline
        );
        vm.stopPrank();

        // Investor 1 holds 100% of supply and claims the entire 6,000.
        vm.prank(investor1);
        distributor.claimRevenue(epochId);

        assertEq(distributor.getRevenueEpoch(epochId).claimedAmount, revenueAmount);

        vm.warp(claimDeadline + 1);

        // Even with fee enabled on token, dust is 0 so no transfer happens and close succeeds.
        feeToken.setFeeBps(1000);

        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        assertTrue(distributor.getRevenueEpoch(epochId).closed);
        assertFalse(token.revenueTransferLocked());
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _activateAssetWithCanonicalToken() internal {
        uint256 offeringId = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        escrow.releaseFunds(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));
    }

    function _attestRevenue(bytes32 evidence, uint256 amount) internal {
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, evidence, amount);
    }
}
