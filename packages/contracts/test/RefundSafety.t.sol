// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetStatus, OfferingStatus, OfferingView} from "../src/ArchpropInterfaces.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title EscrowRefundSafetyTest
 * @notice Adversarial and fuzz testing for failed-offering refund conservation:
 *         - failures permitted only after deadline when raised < target
 *         - exact 1:1 refund of recorded payments
 *         - strictly one-time refund (no double claim)
 *         - non-investors cannot claim refunds
 *         - total refunded never exceeds total raised
 *         - escrow payment-token balance is exactly zero after all participating investors claim
 *         - failed offerings can never release funds, deliver property tokens, or become ACTIVE
 */
contract EscrowRefundSafetyTest is BaseTest {
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

    /// @notice Bounded fuzz test: single investor below target receives exact refund, no double-claim, zero residual.
    function testFuzz_failedOffering_singleInvestorRefundConservation(
        uint256 tokenUnits,
        uint32 timeBeforeDeadline
    ) public {
        tokenUnits = bound(tokenUnits, 1, TOKEN_SUPPLY - 1);
        timeBeforeDeadline = uint32(bound(timeBeforeDeadline, 1, 7 days));
        uint256 payment = tokenUnits * TOKEN_PRICE;

        // Investor1 invests below target
        vm.startPrank(investor1);
        midr.faucet(payment);
        midr.approve(address(escrow), payment);
        escrow.invest(offeringId, payment);
        vm.stopPrank();

        assertEq(escrow.getOffering(offeringId).raised, payment);
        assertLt(payment, TARGET);

        // Invariant: cannot fail offering before deadline
        vm.warp(deadline - timeBeforeDeadline);
        vm.expectRevert(OfferingEscrow.DeadlineNotPassed.selector);
        escrow.failOffering(offeringId);

        // Invariant: cannot claim refund while offering is still OPEN
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.RefundNotAvailable.selector);
        escrow.claimRefund(offeringId);

        // Advance past deadline and fail offering
        vm.warp(deadline + 1);
        assertEq(midr.balanceOf(address(escrow)), payment);

        escrow.failOffering(offeringId);

        // Invariants: state transitions to FAILED in escrow and registry
        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FAILED));
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));

        // Invariant: cannot fail offering a second time
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.failOffering(offeringId);

        // Invariant: FAILED offering cannot deliver property tokens
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.TokenClaimNotAvailable.selector);
        escrow.claimTokens(offeringId);

        // Invariant: FAILED offering cannot release funds
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.releaseFunds(offeringId);

        // Invariant: asset status remains FAILED and cannot become ACTIVE
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));

        // Invariant: non-investor outsider cannot claim refund
        vm.prank(outsider);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);
        assertFalse(escrow.refundClaimed(offeringId, outsider));

        // Invariant: investor receives exactly recorded payment
        uint256 balBefore = midr.balanceOf(investor1);
        vm.prank(investor1);
        escrow.claimRefund(offeringId);

        assertEq(midr.balanceOf(investor1), balBefore + payment);
        assertTrue(escrow.refundClaimed(offeringId, investor1));

        // Invariant: cannot refund twice
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        // Invariant: escrow balance for this offering is strictly zero
        assertEq(midr.balanceOf(address(escrow)), 0);
    }

    /// @notice Bounded fuzz test: two investors below target receive exact refunds, no double claim, balance strictly conserved.
    function testFuzz_failedOffering_twoInvestorRefundConservation(uint256 tokens1, uint256 tokens2)
        public
    {
        tokens1 = bound(tokens1, 1, TOKEN_SUPPLY - 2);
        tokens2 = bound(tokens2, 1, TOKEN_SUPPLY - 1 - tokens1);

        uint256 payment1 = tokens1 * TOKEN_PRICE;
        uint256 payment2 = tokens2 * TOKEN_PRICE;
        uint256 totalRaised = payment1 + payment2;
        assertLt(totalRaised, TARGET);

        // Both investors invest
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

        assertEq(escrow.getOffering(offeringId).raised, totalRaised);
        assertEq(midr.balanceOf(address(escrow)), totalRaised);

        // Invariant: cannot fail before deadline
        vm.expectRevert(OfferingEscrow.DeadlineNotPassed.selector);
        escrow.failOffering(offeringId);

        // Advance past deadline and fail
        vm.warp(deadline + 1);
        escrow.failOffering(offeringId);

        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FAILED));
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));

        // Invariant: token claims and release funds are forbidden
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.TokenClaimNotAvailable.selector);
        escrow.claimTokens(offeringId);

        vm.prank(investor2);
        vm.expectRevert(OfferingEscrow.TokenClaimNotAvailable.selector);
        escrow.claimTokens(offeringId);

        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.releaseFunds(offeringId);

        // Invariant: outsider cannot claim
        vm.prank(outsider);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        // Investor1 refund
        uint256 bal1Before = midr.balanceOf(investor1);
        vm.prank(investor1);
        escrow.claimRefund(offeringId);
        assertEq(midr.balanceOf(investor1), bal1Before + payment1);
        assertTrue(escrow.refundClaimed(offeringId, investor1));

        // Invariant: investor1 cannot claim again
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        // Escrow still holds exactly investor2's payment
        assertEq(midr.balanceOf(address(escrow)), payment2);

        // Investor2 refund
        uint256 bal2Before = midr.balanceOf(investor2);
        vm.prank(investor2);
        escrow.claimRefund(offeringId);
        assertEq(midr.balanceOf(investor2), bal2Before + payment2);
        assertTrue(escrow.refundClaimed(offeringId, investor2));

        // Invariant: investor2 cannot claim again
        vm.prank(investor2);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        // Invariant: total refunded equals total raised; escrow residual balance is zero
        assertEq(midr.balanceOf(address(escrow)), 0);
    }

    /// @notice Bounded fuzz test: zero-investment offering failing at deadline permits no claims or fund releases.
    function testFuzz_failedOffering_zeroInvestmentCannotClaimOrRelease(uint32 extraTime) public {
        extraTime = uint32(bound(extraTime, 1, 30 days));

        // Invariant: cannot fail before deadline
        vm.expectRevert(OfferingEscrow.DeadlineNotPassed.selector);
        escrow.failOffering(offeringId);

        vm.warp(deadline + extraTime);
        escrow.failOffering(offeringId);

        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FAILED));
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));

        // Invariants: anyone calling refund reverts with NothingToClaim
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        vm.prank(outsider);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);

        // Invariant: release funds reverts
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.releaseFunds(offeringId);

        assertEq(midr.balanceOf(address(escrow)), 0);
    }

    /// @notice Bounded fuzz test: fully-funded offering cannot fail even after deadline and must proceed to FUNDED.
    function testFuzz_fundedOffering_cannotFailEvenAfterDeadline(uint32 extraTime) public {
        extraTime = uint32(bound(extraTime, 1, 30 days));

        // Fully fund the offering
        vm.startPrank(investor1);
        midr.faucet(TARGET);
        midr.approve(address(escrow), TARGET);
        escrow.invest(offeringId, TARGET);
        vm.stopPrank();

        assertEq(escrow.getOffering(offeringId).raised, TARGET);

        // Warp past deadline
        vm.warp(deadline + extraTime);

        // Invariant: cannot fail a fully-funded offering
        vm.expectRevert(
            abi.encodeWithSelector(OfferingEscrow.TargetNotReached.selector, TARGET, TARGET)
        );
        escrow.failOffering(offeringId);

        // Must finalize successfully
        escrow.finalizeSuccessfulOffering(offeringId);
        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FUNDED));
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        // Invariant: refund is unavailable for FUNDED offering
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.RefundNotAvailable.selector);
        escrow.claimRefund(offeringId);

        // Token claims and funds release succeed as designed
        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        assertEq(token.balanceOf(investor1), TOKEN_SUPPLY);

        escrow.releaseFunds(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));
        assertEq(midr.balanceOf(treasury), TARGET);
    }
}
