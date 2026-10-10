// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AttestationType, RevenueEpochView} from "../src/ArchpropInterfaces.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title RevenueEpochSequenceTest
 * @notice Adversarial test coverage for sequential revenue epochs and the
 *         token transfer-lock lifecycle (ADR-004 and ADR-009):
 *         1. Publishing epoch A locks AVNUSA transfers (including approved investors).
 *         2. A second epoch cannot open while epoch A remains open; no second deposit trapped.
 *         3. Closing epoch A after its deadline returns unclaimed funds to funder and unlocks transfers.
 *         4. Token transfers after closure update balances; epoch B computes pro-rata shares
 *            against the new holder balances.
 *         5. Epoch B requires distinct evidence and exact deposit; replay of epoch A's evidence
 *            is strictly rejected even after epoch A closes.
 *         6. Aggregate claims cannot exceed deposits; claims against closed epoch A revert.
 *         7. Bounded fuzz testing verifying non-trivial post-A holder splits, zero-decimal integer
 *            rounding, and explicit dust conservation across sequential epochs.
 */
contract RevenueEpochSequenceTest is BaseTest {
    PropertyToken internal token;
    bytes32 internal revenueEvidenceB = keccak256("revenue-evidence-epoch-b");

    event RevenueTransferLockChanged(bool locked);
    event RevenueEpochClosed(uint256 indexed epochId, address indexed funder, uint256 dust);

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
        _activate();
    }

    // -------------------------------------------------------------------------
    // 1. Publishing epoch A locks AVNUSA transfers
    // -------------------------------------------------------------------------

    function test_publishEpochA_locksTransfers_includingApprovedInvestors() public {
        // Initial state: investor1 holds 150,000, investor2 holds 150,000.
        vm.prank(investor1);
        token.transfer(investor2, 150_000);

        assertFalse(token.revenueTransferLocked());

        // Approved transfer succeeds prior to epoch publication.
        vm.prank(investor1);
        token.transfer(investor2, 1_000);
        assertEq(token.balanceOf(investor1), 149_000);
        assertEq(token.balanceOf(investor2), 151_000);

        // Attest revenue for epoch A.
        _attestRevenue(revenueEvidence, 5_000);

        uint64 deadlineA = uint64(block.timestamp + 3 days);
        vm.startPrank(admin);
        midr.faucet(5_000);
        midr.approve(address(distributor), 5_000);

        vm.expectEmit(false, false, false, true, address(token));
        emit RevenueTransferLockChanged(true);

        uint256 epochA = distributor.publishRevenue(
            assetId, address(token), address(midr), 5_000, revenueEvidence, deadlineA
        );
        vm.stopPrank();
        assertEq(epochA, 1);

        // Lock is active.
        assertTrue(token.revenueTransferLocked());

        // 1. Direct transfer between approved investors reverts.
        vm.prank(investor1);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transfer(investor2, 100);

        // 2. Reverse transfer between approved investors reverts.
        vm.prank(investor2);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transfer(investor1, 100);

        // 3. Delegated transferFrom between approved investors reverts.
        vm.prank(investor1);
        token.approve(investor2, 500);
        vm.prank(investor2);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transferFrom(investor1, investor2, 500);

        // 4. Transfer to an unapproved outsider reverts with transfer lock.
        vm.prank(investor1);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transfer(outsider, 100);

        // Token balances remain completely unchanged.
        assertEq(token.balanceOf(investor1), 149_000);
        assertEq(token.balanceOf(investor2), 151_000);
    }

    // -------------------------------------------------------------------------
    // 2. Second epoch cannot open while epoch A remains open; no trapped deposit
    // -------------------------------------------------------------------------

    function test_publishEpoch_secondEpochBlockedWhileFirstOpen_noDepositTrapped() public {
        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, 5_000, deadlineA);
        assertEq(epochA, 1);

        // Distinct valid revenue attestation and funded allowance for epoch B.
        uint256 amountB = 10_000;
        _attestRevenue(revenueEvidenceB, amountB);

        vm.startPrank(admin);
        midr.faucet(amountB);
        midr.approve(address(distributor), amountB);

        uint256 adminBalBefore = midr.balanceOf(admin);
        uint256 distBalBefore = midr.balanceOf(address(distributor));
        uint256 adminAllowanceBefore = midr.allowance(admin, address(distributor));
        uint256 epochCountBefore = distributor.epochCount();

        // Attempting to publish epoch B while epoch A is still open must revert.
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.OpenEpochExists.selector, epochA));
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            amountB,
            revenueEvidenceB,
            uint64(block.timestamp + 5 days)
        );
        vm.stopPrank();

        // Prove no deposit was pulled or trapped.
        assertEq(midr.balanceOf(admin), adminBalBefore);
        assertEq(midr.balanceOf(address(distributor)), distBalBefore);
        assertEq(midr.allowance(admin, address(distributor)), adminAllowanceBefore);

        // Prove evidence B was not marked used and state is uncorrupted.
        assertFalse(distributor.evidenceHashUsed(address(token), revenueEvidenceB));
        assertEq(distributor.openEpochByToken(address(token)), epochA);
        assertEq(distributor.epochCount(), epochCountBefore);
    }

    // -------------------------------------------------------------------------
    // 3. Closing epoch A returns only unclaimed funds and unlocks transfers
    // -------------------------------------------------------------------------

    function test_closeEpochA_returnsUnclaimedFundsToFunder_andUnlocksTransfers() public {
        vm.prank(investor1);
        token.transfer(investor2, 100_000);
        // investor1: 200,000, investor2: 100,000

        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, 6_000, deadlineA);

        // Investor1 claims pro-rata share: 200,000 * 6,000 / 300,000 = 4,000.
        vm.prank(investor1);
        distributor.claimRevenue(epochA);
        assertEq(midr.balanceOf(address(distributor)), 2_000);

        // Investor2 does NOT claim. Unclaimed entitlement is 2,000.

        // Cannot close before deadline passes.
        vm.prank(admin);
        vm.expectRevert(RevenueDistributor.DeadlineNotPassed.selector);
        distributor.closeRevenueEpoch(epochA);

        // Warp past deadline.
        vm.warp(deadlineA + 1);

        uint256 funderBalBefore = midr.balanceOf(admin);

        // Close epoch A: emits lock changed (false) and epoch closed.
        vm.expectEmit(address(token));
        emit RevenueTransferLockChanged(false);
        vm.expectEmit(true, true, false, true, address(distributor));
        emit RevenueEpochClosed(epochA, admin, 2_000);

        vm.prank(admin);
        distributor.closeRevenueEpoch(epochA);

        // Funder receives exactly the unclaimed funds (2,000 mIDR).
        assertEq(midr.balanceOf(admin), funderBalBefore + 2_000);
        assertEq(midr.balanceOf(address(distributor)), 0);

        // Epoch is marked closed.
        RevenueEpochView memory e = distributor.getRevenueEpoch(epochA);
        assertTrue(e.closed);
        assertEq(e.claimedAmount, 4_000);

        // Transfers are unlocked.
        assertFalse(token.revenueTransferLocked());

        // Approved transfer succeeds after closure.
        vm.prank(investor1);
        token.transfer(investor2, 50_000);
        assertEq(token.balanceOf(investor1), 150_000);
        assertEq(token.balanceOf(investor2), 150_000);
    }

    // -------------------------------------------------------------------------
    // 4. Token transfers after closure update balances for epoch B entitlements
    // -------------------------------------------------------------------------

    function test_transferAfterClose_affectsNextEpochEntitlements() public {
        // Setup initial split: 200,000 / 100,000.
        vm.prank(investor1);
        token.transfer(investor2, 100_000);

        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, 6_000, deadlineA);

        // Both investors claim epoch A (4,000 and 2,000).
        vm.prank(investor1);
        distributor.claimRevenue(epochA);
        vm.prank(investor2);
        distributor.claimRevenue(epochA);

        // Close epoch A after deadline.
        vm.warp(deadlineA + 1);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochA);

        // Transfer tokens post-closure: investor1 transfers 150,000 to investor2.
        // New balances: investor1 = 50,000 (1/6), investor2 = 250,000 (5/6).
        vm.prank(investor1);
        token.transfer(investor2, 150_000);
        assertEq(token.balanceOf(investor1), 50_000);
        assertEq(token.balanceOf(investor2), 250_000);

        // Publish epoch B with 12,000 mIDR.
        uint64 deadlineB = uint64(block.timestamp + 3 days);
        uint256 epochB = _publishEpoch(revenueEvidenceB, 12_000, deadlineB);
        assertEq(epochB, 2);

        // Pro-rata entitlement must reflect post-transfer balances:
        // investor1: 50,000 * 12,000 / 300,000 = 2,000 (under old balance it would be 8,000).
        // investor2: 250,000 * 12,000 / 300,000 = 10,000 (under old balance it would be 4,000).
        assertEq(distributor.claimableRevenue(epochB, investor1), 2_000);
        assertEq(distributor.claimableRevenue(epochB, investor2), 10_000);

        uint256 bal1Before = midr.balanceOf(investor1);
        uint256 bal2Before = midr.balanceOf(investor2);

        vm.prank(investor1);
        distributor.claimRevenue(epochB);
        vm.prank(investor2);
        distributor.claimRevenue(epochB);

        assertEq(midr.balanceOf(investor1), bal1Before + 2_000);
        assertEq(midr.balanceOf(investor2), bal2Before + 10_000);
        assertEq(midr.balanceOf(address(distributor)), 0);
    }

    // -------------------------------------------------------------------------
    // 5. Epoch B requires distinct evidence and exact deposit; rejects replay
    // -------------------------------------------------------------------------

    function test_epochB_requiresDistinctEvidence_andExactDeposit_rejectsReplay() public {
        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, 5_000, deadlineA);

        vm.warp(deadlineA + 1);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochA);

        // 1. Evidence replay rejection: reusing revenueEvidence from epoch A fails.
        vm.startPrank(admin);
        midr.faucet(5_000);
        midr.approve(address(distributor), 5_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevenueDistributor.EvidenceHashAlreadyUsed.selector, revenueEvidence
            )
        );
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5_000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();

        // 2. Exact deposit rejection: attestation amount mismatch.
        uint256 attestedAmount = 7_000;
        _attestRevenue(revenueEvidenceB, attestedAmount);

        vm.startPrank(admin);
        midr.faucet(10_000);
        midr.approve(address(distributor), 10_000);

        // Under-deposit reverts with RevenueAttestationInvalid.
        vm.expectRevert(RevenueDistributor.RevenueAttestationInvalid.selector);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            attestedAmount - 1,
            revenueEvidenceB,
            uint64(block.timestamp + 3 days)
        );

        // Over-deposit reverts with RevenueAttestationInvalid.
        vm.expectRevert(RevenueDistributor.RevenueAttestationInvalid.selector);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            attestedAmount + 1,
            revenueEvidenceB,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();

        // 3. Exact matching deposit and distinct evidence succeeds.
        vm.startPrank(admin);
        uint256 epochB = distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            attestedAmount,
            revenueEvidenceB,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();

        assertEq(epochB, 2);
        assertTrue(distributor.evidenceHashUsed(address(token), revenueEvidenceB));
        assertEq(midr.balanceOf(address(distributor)), attestedAmount);
    }

    // -------------------------------------------------------------------------
    // 6. Claims cannot exceed deposits; closed epoch claims strictly revert
    // -------------------------------------------------------------------------

    function test_claimsCannotExceedDeposits_andClosedEpochAClaimsRevert() public {
        vm.prank(investor1);
        token.transfer(investor2, 150_000);

        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, 5_000, deadlineA);

        // Investor1 claims in epoch A.
        vm.prank(investor1);
        distributor.claimRevenue(epochA);

        // Re-claiming in epoch A reverts.
        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.AlreadyClaimed.selector);
        distributor.claimRevenue(epochA);

        // Outsider with 0 tokens reverts.
        vm.prank(outsider);
        vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
        distributor.claimRevenue(epochA);

        // Close epoch A after deadline.
        vm.warp(deadlineA + 1);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochA);

        // Any claim against closed epoch A strictly reverts with EpochClosed.
        vm.prank(investor2);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.claimRevenue(epochA);

        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.claimRevenue(epochA);

        // View reports 0 claimable for closed epoch.
        assertEq(distributor.claimableRevenue(epochA, investor2), 0);
        assertEq(distributor.claimableRevenue(epochA, investor1), 0);

        // Open epoch B.
        uint64 deadlineB = uint64(block.timestamp + 3 days);
        uint256 epochB = _publishEpoch(revenueEvidenceB, 8_000, deadlineB);

        // Both claim epoch B.
        vm.prank(investor1);
        distributor.claimRevenue(epochB);
        vm.prank(investor2);
        distributor.claimRevenue(epochB);

        // Double claim in epoch B reverts.
        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.AlreadyClaimed.selector);
        distributor.claimRevenue(epochB);

        // Total payouts never exceed deposits.
        RevenueEpochView memory viewA = distributor.getRevenueEpoch(epochA);
        RevenueEpochView memory viewB = distributor.getRevenueEpoch(epochB);

        assertLe(viewA.claimedAmount, viewA.amount);
        assertLe(viewB.claimedAmount, viewB.amount);
        assertEq(viewA.claimedAmount, 2_500);
        assertEq(viewB.claimedAmount, 8_000);
    }

    // -------------------------------------------------------------------------
    // 7. Bounded fuzz: non-trivial post-A split, integer rounding & dust conservation
    // -------------------------------------------------------------------------

    function testFuzz_postAHolderSplitAndDust(
        uint256 initialTokens1,
        uint256 transferPostA,
        uint256 amountA,
        uint256 amountB
    ) public {
        // Bound initial token split across whole supply.
        initialTokens1 = bound(initialTokens1, 2, TOKEN_SUPPLY - 2);

        // Bound transfer post-A to ensure non-trivial post-A split.
        transferPostA = bound(transferPostA, 1, initialTokens1 - 1);

        // Bound revenue amounts to practical positive range within faucet limit.
        amountA = bound(amountA, 1, midr.MAX_FAUCET_AMOUNT());
        amountB = bound(amountB, 1, midr.MAX_FAUCET_AMOUNT());

        // Split initial supply.
        vm.prank(investor1);
        token.transfer(investor2, TOKEN_SUPPLY - initialTokens1);

        // 1. Execute epoch A: publish, investor1 claims, close after deadline with dust return.
        _executeEpochA(initialTokens1, amountA);

        // 2. Post-A transfer to create non-trivial changed holder split.
        vm.prank(investor1);
        token.transfer(investor2, transferPostA);

        uint256 newBal1 = initialTokens1 - transferPostA;
        uint256 newBal2 = (TOKEN_SUPPLY - initialTokens1) + transferPostA;
        assertEq(token.balanceOf(investor1), newBal1);
        assertEq(token.balanceOf(investor2), newBal2);
        assertEq(newBal1 + newBal2, TOKEN_SUPPLY);

        // 3. Execute epoch B: verify lock, pro-rata entitlements against new balances, and dust.
        _executeEpochBAndVerifyDust(newBal1, newBal2, amountB);
    }

    // -------------------------------------------------------------------------
    // Fuzz & Suite Helpers
    // -------------------------------------------------------------------------

    function _executeEpochA(uint256 tokens1, uint256 amountA) internal {
        uint64 deadlineA = uint64(block.timestamp + 3 days);
        uint256 epochA = _publishEpoch(revenueEvidence, amountA, deadlineA);

        assertTrue(token.revenueTransferLocked());

        uint256 entA1 = (tokens1 * amountA) / TOKEN_SUPPLY;
        uint256 claimedA = 0;
        if (entA1 > 0) {
            uint256 b1 = midr.balanceOf(investor1);
            vm.prank(investor1);
            distributor.claimRevenue(epochA);
            assertEq(midr.balanceOf(investor1), b1 + entA1);
            claimedA = entA1;
        }

        // Warp past deadline A and close epoch A.
        vm.warp(deadlineA + 1);
        uint256 dustA = amountA - claimedA;

        uint256 funderBeforeCloseA = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochA);

        assertEq(midr.balanceOf(admin), funderBeforeCloseA + dustA);
        assertEq(midr.balanceOf(address(distributor)), 0);
        assertFalse(token.revenueTransferLocked());
    }

    function _executeEpochBAndVerifyDust(uint256 newBal1, uint256 newBal2, uint256 amountB)
        internal
    {
        uint64 deadlineB = uint64(block.timestamp + 3 days);
        uint256 epochB = _publishEpoch(revenueEvidenceB, amountB, deadlineB);

        // Transfers are locked again for epoch B.
        assertTrue(token.revenueTransferLocked());
        vm.prank(investor1);
        vm.expectRevert(PropertyToken.TransfersLockedForRevenue.selector);
        token.transfer(investor2, 1);

        // Invariant: Entitlements computed against new balances.
        uint256 entB1 = (newBal1 * amountB) / TOKEN_SUPPLY;
        uint256 entB2 = (newBal2 * amountB) / TOKEN_SUPPLY;
        assertEq(distributor.claimableRevenue(epochB, investor1), entB1);
        assertEq(distributor.claimableRevenue(epochB, investor2), entB2);

        // Invariant: Aggregate entitlement never exceeds deposit due to integer floor division.
        assertLe(entB1 + entB2, amountB);

        uint256 claimedB = 0;
        if (entB1 > 0) {
            uint256 b1 = midr.balanceOf(investor1);
            vm.prank(investor1);
            distributor.claimRevenue(epochB);
            assertEq(midr.balanceOf(investor1), b1 + entB1);
            claimedB += entB1;
        } else {
            vm.prank(investor1);
            vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
            distributor.claimRevenue(epochB);
        }

        if (entB2 > 0) {
            uint256 b2 = midr.balanceOf(investor2);
            vm.prank(investor2);
            distributor.claimRevenue(epochB);
            assertEq(midr.balanceOf(investor2), b2 + entB2);
            claimedB += entB2;
        } else {
            vm.prank(investor2);
            vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
            distributor.claimRevenue(epochB);
        }

        // Expected integer rounding dust.
        uint256 expectedDustB = amountB - claimedB;
        assertEq(midr.balanceOf(address(distributor)), expectedDustB);

        // Warp past deadline B and close epoch B.
        vm.warp(deadlineB + 1);
        uint256 funderBeforeCloseB = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochB);

        // Invariant: Exact dust returned to funder, zero payment token stuck in distributor.
        assertEq(midr.balanceOf(admin), funderBeforeCloseB + expectedDustB);
        assertEq(midr.balanceOf(address(distributor)), 0);

        // Transfers unlocked again after epoch B closure.
        assertFalse(token.revenueTransferLocked());
    }

    function _activate() internal {
        uint256 id = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(id);
        escrow.releaseFunds(id);
    }

    function _attestRevenue(bytes32 evidence, uint256 amount) internal {
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, evidence, amount);
    }

    function _publishEpoch(bytes32 evidence, uint256 amount, uint64 deadline)
        internal
        returns (uint256)
    {
        _attestRevenue(evidence, amount);
        vm.startPrank(admin);
        midr.faucet(amount);
        midr.approve(address(distributor), amount);
        uint256 id = distributor.publishRevenue(
            assetId, address(token), address(midr), amount, evidence, deadline
        );
        vm.stopPrank();
        return id;
    }
}
