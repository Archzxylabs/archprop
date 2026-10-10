// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    AssetStatus,
    AttestationType,
    OfferingView,
    RevenueEpochView
} from "../src/ArchpropInterfaces.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title EscrowEconomicInvariantsTest
 * @notice Fuzz testing for primary offering economic invariants:
 *         - whole-token payment multiples
 *         - exact allocation accounting: allocation == payment / tokenPrice
 *         - raised never exceeds target
 *         - overfill and non-whole token payment rejection
 */
contract EscrowEconomicInvariantsTest is BaseTest {
    PropertyToken internal token;
    uint256 internal offeringId;
    uint64 internal deadline;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
        deadline = uint64(block.timestamp + 7 days);

        vm.prank(structurer);
        offeringId = escrow.createOffering(
            assetId, address(token), address(midr), TARGET, TOKEN_PRICE, deadline, treasury
        );
    }

    /// @notice Bounded fuzz test: whole-token investments allocate exactly payment / price and raised <= target.
    function testFuzz_invest_wholeTokenAllocationAndRaisedBounds(uint256 tokenUnits) public {
        tokenUnits = bound(tokenUnits, 1, TOKEN_SUPPLY);
        uint256 payment = tokenUnits * TOKEN_PRICE;

        vm.startPrank(investor1);
        midr.faucet(payment);
        midr.approve(address(escrow), payment);
        escrow.invest(offeringId, payment);
        vm.stopPrank();

        // Invariant: payment recorded matches exact whole-unit payment
        assertEq(escrow.paymentOf(offeringId, investor1), payment);
        // Invariant: allocation equals payment / tokenPrice exactly
        assertEq(escrow.allocationOf(offeringId, investor1), tokenUnits);
        assertEq(escrow.allocationOf(offeringId, investor1), payment / TOKEN_PRICE);

        OfferingView memory o = escrow.getOffering(offeringId);
        // Invariant: raised equals payment and never exceeds target
        assertEq(o.raised, payment);
        assertLe(o.raised, TARGET);
        assertEq(escrow.remainingCapacity(offeringId), TARGET - payment);
    }

    /// @notice Bounded fuzz test: two investors' combined whole-token investments respect allocation and raised <= target.
    function testFuzz_invest_twoInvestorsCombinedRaisedNeverExceedsTarget(
        uint256 tokens1,
        uint256 tokens2
    ) public {
        tokens1 = bound(tokens1, 1, TOKEN_SUPPLY - 1);
        tokens2 = bound(tokens2, 1, TOKEN_SUPPLY - tokens1);

        uint256 payment1 = tokens1 * TOKEN_PRICE;
        uint256 payment2 = tokens2 * TOKEN_PRICE;

        vm.startPrank(investor1);
        midr.faucet(payment1);
        midr.approve(address(escrow), payment1);
        escrow.invest(offeringId, payment1);
        vm.stopPrank();

        vm.startPrank(investor2);
        midr.faucet(payment2);
        midr.approve(address(escrow), payment2);
        escrow.invest(offeringId, payment2);
        vm.stopPrank();

        // Invariants: per-investor allocations match payment / price
        assertEq(escrow.allocationOf(offeringId, investor1), tokens1);
        assertEq(escrow.allocationOf(offeringId, investor2), tokens2);
        assertEq(escrow.paymentOf(offeringId, investor1), payment1);
        assertEq(escrow.paymentOf(offeringId, investor2), payment2);

        // Invariant: aggregate raised is exact sum and <= target
        OfferingView memory o = escrow.getOffering(offeringId);
        assertEq(o.raised, payment1 + payment2);
        assertLe(o.raised, TARGET);
        assertEq(escrow.remainingCapacity(offeringId), TARGET - (payment1 + payment2));

        // If target reached, finalization succeeds and transitions to FUNDED
        if (tokens1 + tokens2 == TOKEN_SUPPLY) {
            assertEq(o.raised, TARGET);
            escrow.finalizeSuccessfulOffering(offeringId);
            assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));
        }
    }

    /// @notice Bounded fuzz test: overfill attempts strictly revert with OfferingFull and leave raised unchanged.
    function testFuzz_invest_overfillReverts(uint256 initialTokens, uint256 overfillUnits) public {
        initialTokens = bound(initialTokens, 0, TOKEN_SUPPLY);
        overfillUnits = bound(overfillUnits, 1, 100_000);

        uint256 initialPayment = initialTokens * TOKEN_PRICE;
        if (initialPayment > 0) {
            vm.startPrank(investor1);
            midr.faucet(initialPayment);
            midr.approve(address(escrow), initialPayment);
            escrow.invest(offeringId, initialPayment);
            vm.stopPrank();
        }

        uint256 remaining = TARGET - initialPayment;
        uint256 overfillPayment = remaining + (overfillUnits * TOKEN_PRICE);

        // Invariant: overfill investment reverts with OfferingFull(remaining)
        vm.startPrank(investor2);
        midr.faucet(overfillPayment);
        midr.approve(address(escrow), overfillPayment);

        vm.expectRevert(abi.encodeWithSelector(OfferingEscrow.OfferingFull.selector, remaining));
        escrow.invest(offeringId, overfillPayment);
        vm.stopPrank();

        // Invariant: state remains uncorrupted
        assertEq(escrow.getOffering(offeringId).raised, initialPayment);
        assertLe(escrow.getOffering(offeringId).raised, TARGET);
        assertEq(escrow.paymentOf(offeringId, investor2), 0);
        assertEq(escrow.allocationOf(offeringId, investor2), 0);
    }

    /// @notice Bounded fuzz test: fractional / non-whole-token payments strictly revert.
    function testFuzz_invest_nonWholeTokenReverts(uint256 tokenUnits, uint256 remainder) public {
        tokenUnits = bound(tokenUnits, 0, TOKEN_SUPPLY - 1);
        remainder = bound(remainder, 1, TOKEN_PRICE - 1);
        uint256 nonWholePayment = (tokenUnits * TOKEN_PRICE) + remainder;

        vm.startPrank(investor1);
        midr.faucet(nonWholePayment);
        midr.approve(address(escrow), nonWholePayment);

        // Invariant: payment % TOKEN_PRICE != 0 reverts with NotWholeTokenAmount
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.NotWholeTokenAmount.selector, nonWholePayment, TOKEN_PRICE
            )
        );
        escrow.invest(offeringId, nonWholePayment);
        vm.stopPrank();

        assertEq(escrow.getOffering(offeringId).raised, 0);
        assertEq(escrow.allocationOf(offeringId, investor1), 0);
    }
}

/**
 * @title RevenueEconomicInvariantsTest
 * @notice Fuzz testing for revenue-accounting invariants across two holders:
 *         - total escrow tokens claimed before publication
 *         - entitlement equals balance * fundedAmount / totalSupply
 *         - total claimed amount never exceeds funded amount
 *         - dust equals fundedAmount - totalClaimed and returns only after closure
 */
contract RevenueEconomicInvariantsTest is BaseTest {
    PropertyToken internal token;
    uint64 internal revenueDeadline;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
    }

    /// @notice Bounded fuzz test: two holders pro-rata entitlement, claims <= funded, and dust return on closure across full range.
    function testFuzz_twoHolderRevenue_entitlementAndDustAccounting(
        uint256 tokens1,
        uint256 fundedRevenue
    ) public {
        // Bound two holders so they split the exact fixed supply of 300,000 AVNUSA
        tokens1 = bound(tokens1, 1, TOKEN_SUPPLY - 1);
        uint256 tokens2 = TOKEN_SUPPLY - tokens1;
        // Bound funded revenue to practical range within MockIDR faucet bounds
        fundedRevenue = bound(fundedRevenue, 1, midr.MAX_FAUCET_AMOUNT());

        // 1. Escrow primary offering
        vm.startPrank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        vm.stopPrank();

        // Both investors fund the offering completely
        uint256 p1 = tokens1 * TOKEN_PRICE;
        uint256 p2 = tokens2 * TOKEN_PRICE;

        vm.startPrank(investor1);
        midr.faucet(p1);
        midr.approve(address(escrow), p1);
        escrow.invest(offeringId, p1);
        vm.stopPrank();

        vm.startPrank(investor2);
        midr.faucet(p2);
        midr.approve(address(escrow), p2);
        escrow.invest(offeringId, p2);
        vm.stopPrank();

        escrow.finalizeSuccessfulOffering(offeringId);

        // 2. Both investors claim all tokens (escrow holds 0 remaining tokens)
        vm.prank(investor1);
        escrow.claimTokens(offeringId);

        vm.prank(investor2);
        escrow.claimTokens(offeringId);

        // Invariant: all tokens claimed from escrow
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(investor1), tokens1);
        assertEq(token.balanceOf(investor2), tokens2);
        assertEq(tokens1 + tokens2, TOKEN_SUPPLY);

        // 3. Escrow releases funds and activates asset
        escrow.releaseFunds(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));

        // 4. Submit revenue attestation and publish revenue
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, fundedRevenue);

        revenueDeadline = uint64(block.timestamp + 3 days);
        vm.startPrank(admin);
        midr.faucet(fundedRevenue);
        midr.approve(address(distributor), fundedRevenue);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(midr), fundedRevenue, revenueEvidence, revenueDeadline
        );
        vm.stopPrank();

        // Invariant: transfers locked during epoch
        assertTrue(token.revenueTransferLocked());

        // Invariant: mathematical entitlement equals balance * fundedRevenue / totalSupply
        uint256 expected1 = (tokens1 * fundedRevenue) / TOKEN_SUPPLY;
        uint256 expected2 = (tokens2 * fundedRevenue) / TOKEN_SUPPLY;
        assertEq(distributor.claimableRevenue(epochId, investor1), expected1);
        assertEq(distributor.claimableRevenue(epochId, investor2), expected2);

        // Invariant: sum of entitlements never exceeds deposited revenue
        assertLe(expected1 + expected2, fundedRevenue);

        // 5. Investors claim their entitlements (if non-zero in whole units)
        uint256 claimed1 = 0;
        if (expected1 > 0) {
            uint256 bal1Before = midr.balanceOf(investor1);
            vm.prank(investor1);
            distributor.claimRevenue(epochId);
            assertEq(midr.balanceOf(investor1), bal1Before + expected1);
            assertEq(distributor.claimableRevenue(epochId, investor1), 0);
            assertTrue(distributor.revenueClaimed(epochId, investor1));
            claimed1 = expected1;
        } else {
            vm.prank(investor1);
            vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
            distributor.claimRevenue(epochId);
            assertFalse(distributor.revenueClaimed(epochId, investor1));
        }

        uint256 claimed2 = 0;
        if (expected2 > 0) {
            uint256 bal2Before = midr.balanceOf(investor2);
            vm.prank(investor2);
            distributor.claimRevenue(epochId);
            assertEq(midr.balanceOf(investor2), bal2Before + expected2);
            assertEq(distributor.claimableRevenue(epochId, investor2), 0);
            assertTrue(distributor.revenueClaimed(epochId, investor2));
            claimed2 = expected2;
        } else {
            vm.prank(investor2);
            vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
            distributor.claimRevenue(epochId);
            assertFalse(distributor.revenueClaimed(epochId, investor2));
        }

        uint256 totalClaimed = claimed1 + claimed2;
        uint256 expectedDust = fundedRevenue - totalClaimed;

        // Invariant: total claimed in distributor equals sum of individual claims
        RevenueEpochView memory epoch = distributor.getRevenueEpoch(epochId);
        assertEq(epoch.claimedAmount, totalClaimed);
        assertLe(epoch.claimedAmount, fundedRevenue);
        // Distributor holds exact dust
        assertEq(midr.balanceOf(address(distributor)), expectedDust);

        // Invariant: admin cannot close epoch before deadline
        vm.prank(admin);
        vm.expectRevert(RevenueDistributor.DeadlineNotPassed.selector);
        distributor.closeRevenueEpoch(epochId);

        // 6. Close epoch after deadline
        vm.warp(revenueDeadline + 1);

        uint256 adminBalBefore = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        // Invariant: dust returned to admin funder on closure
        assertEq(midr.balanceOf(admin), adminBalBefore + expectedDust);
        // Invariant: distributor balance is now exactly 0
        assertEq(midr.balanceOf(address(distributor)), 0);
        // Invariant: transfers unlocked
        assertFalse(token.revenueTransferLocked());

        // Invariant: further claims are locked
        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.claimRevenue(epochId);
    }

    /// @notice Bounded fuzz test: practical distribution where fundedRevenue >= totalSupply so both holders receive >= 1 unit.
    function testFuzz_twoHolderRevenue_bothHoldersClaimNonZero(
        uint256 tokens1,
        uint256 fundedRevenue
    ) public {
        tokens1 = bound(tokens1, 1, TOKEN_SUPPLY - 1);
        uint256 tokens2 = TOKEN_SUPPLY - tokens1;
        // Bounded so fundedRevenue >= TOKEN_SUPPLY, guaranteeing both holders get >= 1 mIDR
        fundedRevenue = bound(fundedRevenue, TOKEN_SUPPLY, midr.MAX_FAUCET_AMOUNT());

        // Primary offering
        vm.startPrank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        vm.stopPrank();

        uint256 p1 = tokens1 * TOKEN_PRICE;
        uint256 p2 = tokens2 * TOKEN_PRICE;

        vm.startPrank(investor1);
        midr.faucet(p1);
        midr.approve(address(escrow), p1);
        escrow.invest(offeringId, p1);
        vm.stopPrank();

        vm.startPrank(investor2);
        midr.faucet(p2);
        midr.approve(address(escrow), p2);
        escrow.invest(offeringId, p2);
        vm.stopPrank();

        escrow.finalizeSuccessfulOffering(offeringId);

        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        vm.prank(investor2);
        escrow.claimTokens(offeringId);

        escrow.releaseFunds(offeringId);

        // Publish revenue
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, fundedRevenue);

        revenueDeadline = uint64(block.timestamp + 3 days);
        vm.startPrank(admin);
        midr.faucet(fundedRevenue);
        midr.approve(address(distributor), fundedRevenue);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(midr), fundedRevenue, revenueEvidence, revenueDeadline
        );
        vm.stopPrank();

        uint256 expected1 = (tokens1 * fundedRevenue) / TOKEN_SUPPLY;
        uint256 expected2 = (tokens2 * fundedRevenue) / TOKEN_SUPPLY;
        assertGt(expected1, 0);
        assertGt(expected2, 0);

        uint256 bal1Before = midr.balanceOf(investor1);
        vm.prank(investor1);
        distributor.claimRevenue(epochId);
        assertEq(midr.balanceOf(investor1), bal1Before + expected1);

        uint256 bal2Before = midr.balanceOf(investor2);
        vm.prank(investor2);
        distributor.claimRevenue(epochId);
        assertEq(midr.balanceOf(investor2), bal2Before + expected2);

        uint256 totalClaimed = expected1 + expected2;
        assertLe(totalClaimed, fundedRevenue);
        uint256 dust = fundedRevenue - totalClaimed;

        vm.warp(revenueDeadline + 1);
        uint256 adminBalBefore = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        assertEq(midr.balanceOf(admin), adminBalBefore + dust);
        assertEq(midr.balanceOf(address(distributor)), 0);
    }

    /// @notice Bounded fuzz test: if a holder does not claim, their share remains dust and returns to funder upon closure.
    function testFuzz_twoHolderRevenue_unclaimedEntitlementReturnedAsDust(
        uint256 tokens1,
        uint256 fundedRevenue
    ) public {
        tokens1 = bound(tokens1, 1, TOKEN_SUPPLY - 1);
        uint256 tokens2 = TOKEN_SUPPLY - tokens1;
        fundedRevenue = bound(fundedRevenue, 1, midr.MAX_FAUCET_AMOUNT());

        // Setup funded offering & claims
        vm.startPrank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        vm.stopPrank();

        uint256 p1 = tokens1 * TOKEN_PRICE;
        uint256 p2 = tokens2 * TOKEN_PRICE;

        vm.startPrank(investor1);
        midr.faucet(p1);
        midr.approve(address(escrow), p1);
        escrow.invest(offeringId, p1);
        vm.stopPrank();

        vm.startPrank(investor2);
        midr.faucet(p2);
        midr.approve(address(escrow), p2);
        escrow.invest(offeringId, p2);
        vm.stopPrank();

        escrow.finalizeSuccessfulOffering(offeringId);

        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        vm.prank(investor2);
        escrow.claimTokens(offeringId);

        escrow.releaseFunds(offeringId);

        // Publish revenue
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, fundedRevenue);

        revenueDeadline = uint64(block.timestamp + 3 days);
        vm.startPrank(admin);
        midr.faucet(fundedRevenue);
        midr.approve(address(distributor), fundedRevenue);
        uint256 epochId = distributor.publishRevenue(
            assetId, address(token), address(midr), fundedRevenue, revenueEvidence, revenueDeadline
        );
        vm.stopPrank();

        uint256 expected1 = (tokens1 * fundedRevenue) / TOKEN_SUPPLY;

        // ONLY investor1 claims (if entitlement > 0)
        uint256 claimed1 = 0;
        if (expected1 > 0) {
            vm.prank(investor1);
            distributor.claimRevenue(epochId);
            claimed1 = expected1;
        }

        // Warp past deadline
        vm.warp(revenueDeadline + 1);

        uint256 adminBalBefore = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        // Invariant: all remaining funds in epoch return to funder
        uint256 totalDust = fundedRevenue - claimed1;
        assertEq(midr.balanceOf(admin), adminBalBefore + totalDust);
        assertEq(midr.balanceOf(address(distributor)), 0);

        // Invariant: investor2 is now locked out from claiming
        vm.prank(investor2);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.claimRevenue(epochId);
    }
}
