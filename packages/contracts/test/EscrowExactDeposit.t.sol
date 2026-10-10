// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetStatus, OfferingStatus, OfferingView} from "../src/ArchpropInterfaces.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {BaseTest} from "./Base.t.sol";
import {MockFeeToken} from "./MockFeeToken.sol";

/**
 * @title EscrowExactDepositTest
 * @notice Tests the exact-deposit invariant in OfferingEscrow.invest (ADR-013):
 *         - Fee-on-transfer / deflationary payment tokens revert atomically with AmountMismatch.
 *         - State rollback: raised, payment, and allocation remain 0; escrow holds no residual deposit.
 *         - Normal MockIDR flow: fully funds offering, finalizes, claims tokens, releases funds.
 *         - Refund flow: failed offering distributes refunds with conservation.
 *         - Bounded fuzz testing proving no undercollateralized deposit can be credited.
 */
contract EscrowExactDepositTest is BaseTest {
    PropertyToken internal token;
    MockFeeToken internal feeToken;
    MockFeeToken internal burnToken;
    address internal feeCollector = makeAddr("feeCollector");

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);

        feeToken = new MockFeeToken("Fee Token", "FEE", 500, feeCollector, false); // 5% fee
        burnToken = new MockFeeToken("Burn Token", "BURN", 1000, address(0), true); // 10% burn fee
    }

    // -------------------------------------------------------------------------
    // 1. Fee-on-transfer token rejection and rollback
    // -------------------------------------------------------------------------

    function test_invest_feeOnTransfer_revertsWithAmountMismatch() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(feeToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 paymentAmount = 100 * TOKEN_PRICE; // 1,000,000 units
        feeToken.mint(investor1, paymentAmount);

        vm.startPrank(investor1);
        feeToken.approve(address(escrow), paymentAmount);

        // 5% fee means escrow would only receive 950,000 units.
        uint256 expectedReceived = paymentAmount - (paymentAmount * 500 / 10_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.AmountMismatch.selector, paymentAmount, expectedReceived
            )
        );
        escrow.invest(offeringId, paymentAmount);
        vm.stopPrank();

        // Invariants: State is untouched, no funds trapped in escrow.
        assertEq(escrow.paymentOf(offeringId, investor1), 0);
        assertEq(escrow.allocationOf(offeringId, investor1), 0);
        assertEq(escrow.getOffering(offeringId).raised, 0);
        assertEq(feeToken.balanceOf(address(escrow)), 0);
        assertEq(feeToken.balanceOf(investor1), paymentAmount);
        assertEq(feeToken.balanceOf(feeCollector), 0);
    }

    // -------------------------------------------------------------------------
    // 2. Deflationary / burn fee token rejection and rollback
    // -------------------------------------------------------------------------

    function test_invest_deflationaryBurn_revertsWithAmountMismatch() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(burnToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 paymentAmount = 50 * TOKEN_PRICE; // 500,000 units
        burnToken.mint(investor1, paymentAmount);

        vm.startPrank(investor1);
        burnToken.approve(address(escrow), paymentAmount);

        // 10% burn fee means escrow would only receive 450,000 units.
        uint256 expectedReceived = paymentAmount - (paymentAmount * 1000 / 10_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.AmountMismatch.selector, paymentAmount, expectedReceived
            )
        );
        escrow.invest(offeringId, paymentAmount);
        vm.stopPrank();

        // Invariants: State is untouched, no funds trapped in escrow.
        assertEq(escrow.paymentOf(offeringId, investor1), 0);
        assertEq(escrow.allocationOf(offeringId, investor1), 0);
        assertEq(escrow.getOffering(offeringId).raised, 0);
        assertEq(burnToken.balanceOf(address(escrow)), 0);
        assertEq(burnToken.balanceOf(investor1), paymentAmount);
    }

    // -------------------------------------------------------------------------
    // 3. Zero-fee token succeeds cleanly
    // -------------------------------------------------------------------------

    function test_invest_zeroFeeToken_succeeds() public {
        feeToken.setFeeBps(0);

        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(feeToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 paymentAmount = 10 * TOKEN_PRICE;
        feeToken.mint(investor1, paymentAmount);

        vm.startPrank(investor1);
        feeToken.approve(address(escrow), paymentAmount);
        escrow.invest(offeringId, paymentAmount);
        vm.stopPrank();

        assertEq(escrow.paymentOf(offeringId, investor1), paymentAmount);
        assertEq(escrow.allocationOf(offeringId, investor1), 10);
        assertEq(escrow.getOffering(offeringId).raised, paymentAmount);
        assertEq(feeToken.balanceOf(address(escrow)), paymentAmount);
    }

    // -------------------------------------------------------------------------
    // 4. Normal MockIDR lifecycle: full target, finalize, claim, release
    // -------------------------------------------------------------------------

    function test_normalMockIDR_fullTarget_finalize_claim_release() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(midr), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 half = TARGET / 2; // 1,500,000,000

        // Investor 1 funds first half.
        vm.startPrank(investor1);
        midr.faucet(half);
        midr.approve(address(escrow), half);
        escrow.invest(offeringId, half);
        vm.stopPrank();

        // Investor 2 funds second half.
        vm.startPrank(investor2);
        midr.faucet(half);
        midr.approve(address(escrow), half);
        escrow.invest(offeringId, half);
        vm.stopPrank();

        assertEq(escrow.getOffering(offeringId).raised, TARGET);
        assertEq(midr.balanceOf(address(escrow)), TARGET);

        // Finalize offering.
        escrow.finalizeSuccessfulOffering(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        // Both claim tokens.
        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        vm.prank(investor2);
        escrow.claimTokens(offeringId);

        assertEq(token.balanceOf(investor1), 150_000);
        assertEq(token.balanceOf(investor2), 150_000);
        assertEq(token.balanceOf(address(escrow)), 0);

        // Release funds to treasury.
        uint256 treasuryBefore = midr.balanceOf(treasury);
        escrow.releaseFunds(offeringId);

        assertEq(midr.balanceOf(treasury), treasuryBefore + TARGET);
        assertEq(midr.balanceOf(address(escrow)), 0);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));
    }

    // -------------------------------------------------------------------------
    // 5. Normal MockIDR failed offering: refund conservation
    // -------------------------------------------------------------------------

    function test_normalMockIDR_failedOffering_refundConservation() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(midr), TARGET, TOKEN_PRICE, deadline, treasury
        );

        uint256 p1 = 50 * TOKEN_PRICE; // 500,000
        uint256 p2 = 100 * TOKEN_PRICE; // 1,000,000

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

        assertEq(midr.balanceOf(address(escrow)), p1 + p2);

        // Pass deadline and fail offering.
        vm.warp(deadline + 1);
        escrow.failOffering(offeringId);
        assertEq(uint256(escrow.getOffering(offeringId).status), uint256(OfferingStatus.FAILED));

        // Investor 1 claims refund.
        uint256 bal1Before = midr.balanceOf(investor1);
        vm.prank(investor1);
        escrow.claimRefund(offeringId);
        assertEq(midr.balanceOf(investor1), bal1Before + p1);

        // Investor 2 claims refund.
        uint256 bal2Before = midr.balanceOf(investor2);
        vm.prank(investor2);
        escrow.claimRefund(offeringId);
        assertEq(midr.balanceOf(investor2), bal2Before + p2);

        // Invariant: Escrow holds exactly 0 payment tokens after all refunds.
        assertEq(midr.balanceOf(address(escrow)), 0);

        // Double claim reverts with NothingToClaim.
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);
    }

    // -------------------------------------------------------------------------
    // 6. Bounded fuzz: any fee percentage strictly reverts with AmountMismatch
    // -------------------------------------------------------------------------

    function testFuzz_feeToken_anyFeeBps_strictlyReverts(uint256 feeBps, uint256 tokenUnits)
        public
    {
        feeBps = bound(feeBps, 1, 9_999);
        tokenUnits = bound(tokenUnits, 1, 100);
        uint256 paymentAmount = tokenUnits * TOKEN_PRICE;

        feeToken.setFeeBps(feeBps);

        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(structurer);
        uint256 offeringId = escrow.createOffering(
            assetId, address(token), address(feeToken), TARGET, TOKEN_PRICE, deadline, treasury
        );

        feeToken.mint(investor1, paymentAmount);

        vm.startPrank(investor1);
        feeToken.approve(address(escrow), paymentAmount);

        uint256 fee = (paymentAmount * feeBps) / 10_000;
        if (fee == 0 && paymentAmount > 0) fee = 1;
        uint256 expectedReceived = paymentAmount - fee;

        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.AmountMismatch.selector, paymentAmount, expectedReceived
            )
        );
        escrow.invest(offeringId, paymentAmount);
        vm.stopPrank();

        // Invariants: Zero state credited, zero funds trapped in escrow.
        assertEq(escrow.paymentOf(offeringId, investor1), 0);
        assertEq(escrow.allocationOf(offeringId, investor1), 0);
        assertEq(escrow.getOffering(offeringId).raised, 0);
        assertEq(feeToken.balanceOf(address(escrow)), 0);
    }
}
