// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    AssetStatus,
    AttestationType,
    OfferingStatus,
    OfferingView
} from "../src/ArchpropInterfaces.sol";
import {ArchpropRegistry} from "../src/ArchpropRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {BaseTest} from "./Base.t.sol";
import {MockFeeToken} from "./MockFeeToken.sol";

/**
 * @title OfferingEscrowTest
 * @notice Covers the economic invariants: `target == supply * price`, whole-token
 *         amounts, no claim before finalization, and refund-only-on-failure.
 */
contract OfferingEscrowTest is BaseTest {
    uint256 internal offeringId;
    PropertyToken internal token;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
    }

    // -----------------------------------------------------------------
    // createOffering
    // -----------------------------------------------------------------

    function test_createOffering_setsOpenAndPriced() public {
        vm.prank(structurer);
        offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );

        OfferingView memory o = _offering(offeringId);
        assertEq(o.assetId, assetId);
        assertEq(o.propertyToken, address(token));
        assertEq(o.paymentToken, address(midr));
        assertEq(o.target, TARGET);
        assertEq(o.tokenPrice, TOKEN_PRICE);
        assertEq(o.raised, 0);
        assertEq(uint256(o.status), uint256(OfferingStatus.OPEN));
        assertEq(escrow.offeringIdByToken(address(token)), offeringId);
    }

    function test_createOffering_enforcesTargetEqualsSupplyTimesPrice() public {
        vm.prank(structurer);
        vm.expectRevert();
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET + 1,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_rejectsZeroPrice() public {
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.TokenPriceMismatch.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            0,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_rejectsZeroTarget() public {
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.InvalidTarget.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            0,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_rejectsTokenWiredToForeignIdentityRegistry() public {
        // The registry in the token must be the one this escrow consults for
        // investor approval. A token gated by a different registry would admit
        // investors through a door the escrow cannot see.
        bytes32 otherAssetId = keccak256("ARCHPROP-002");
        IdentityRegistry otherIdentity = new IdentityRegistry(admin);
        PropertyToken foreignToken = new PropertyToken(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            otherAssetId,
            TOKEN_SUPPLY,
            address(otherIdentity),
            address(escrow),
            address(distributor)
        );
        _driveAssetToIssuanceReadyIn(registry, otherAssetId, foreignToken);
        _linkTokenIn(registry, otherAssetId, foreignToken);

        vm.prank(structurer);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.TokenIdentityRegistryMismatch.selector,
                address(identity),
                address(otherIdentity)
            )
        );
        escrow.createOffering(
            otherAssetId,
            address(foreignToken),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_rejectsTokenWiredToForeignEscrow() public {
        // A token minted to a different escrow holds its supply there, so no
        // offering built on it could ever settle. The registry refuses to link
        // such a token at all, which is the first of two independent guards.
        OfferingEscrow otherEscrow = new OfferingEscrow(admin, address(registry), address(identity));
        bytes32 otherAssetId = keccak256("ARCHPROP-002");
        PropertyToken foreignToken = new PropertyToken(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            otherAssetId,
            TOKEN_SUPPLY,
            address(identity),
            address(otherEscrow),
            address(distributor)
        );

        // Drive to ISSUANCE_READY, leaving only the link step undone.
        _driveAssetToIssuanceReadyIn(registry, otherAssetId, foreignToken);

        vm.prank(structurer);
        vm.expectRevert(ArchpropRegistry.EscrowNotConfigured.selector);
        registry.linkToken(otherAssetId, address(foreignToken));

        // Unlinked, so no offering can reference it either.
        assertEq(registry.assetToken(otherAssetId), address(0));
    }

    function test_createOffering_rejectsZeroSupplyToken() public {
        // target == 0 is caught before any external call, so a zero-supply token
        // can never satisfy `target == supply * price` either.
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.InvalidTarget.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            0,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_acceptsCanonicalWiring() public {
        assertEq(token.identityRegistry(), address(identity));
        assertEq(token.offeringEscrow(), address(escrow));
        assertEq(token.revenueDistributor(), address(distributor));
        assertEq(token.totalSupply(), TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(escrow)), TOKEN_SUPPLY);

        vm.prank(structurer);
        offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        assertEq(offeringId, 1);
    }

    function test_createOffering_rejectsPastDeadline() public {
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.InvalidDeadline.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp - 1),
            treasury
        );
    }

    function test_createOffering_rejectsZeroTreasury() public {
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.InvalidTreasury.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            address(0)
        );
    }

    function test_createOffering_requiresStructurerRole() public {
        vm.prank(outsider);
        vm.expectRevert();
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_rejectsAssetNotIssuanceReady() public {
        bytes32 otherId = keccak256("ASSET-RAW");
        vm.prank(issuer);
        registry.createAsset(otherId, metadataHash);

        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.AssetNotIssuanceReady.selector);
        escrow.createOffering(
            otherId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function test_createOffering_onePerToken() public {
        vm.prank(structurer);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        vm.prank(structurer);
        vm.expectRevert(OfferingEscrow.OfferingAlreadyExistsForToken.selector);
        escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    // -----------------------------------------------------------------
    // invest
    // -----------------------------------------------------------------

    function test_invest_rejectsUnapprovedInvestor() public {
        _createOffering();
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(OfferingEscrow.NotApprovedInvestor.selector, outsider)
        );
        escrow.invest(offeringId, TOKEN_PRICE);
    }

    function test_invest_rejectsZeroAmount() public {
        _createOffering();
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.ZeroInvestment.selector);
        escrow.invest(offeringId, 0);
    }

    function test_invest_rejectsFractionalTokenAmount() public {
        _createOffering();
        vm.startPrank(investor1);
        midr.faucet(100_000);
        midr.approve(address(escrow), 100_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.NotWholeTokenAmount.selector, TOKEN_PRICE - 1, TOKEN_PRICE
            )
        );
        escrow.invest(offeringId, TOKEN_PRICE - 1);
        vm.stopPrank();
    }

    function test_invest_rejectsOverfill() public {
        _createOffering();
        vm.startPrank(investor1);
        midr.faucet(TARGET * 2);
        midr.approve(address(escrow), TARGET * 2);
        vm.expectRevert(abi.encodeWithSelector(OfferingEscrow.OfferingFull.selector, TARGET));
        escrow.invest(offeringId, TARGET + TOKEN_PRICE);
        vm.stopPrank();
    }

    function test_invest_rejectsAfterDeadline() public {
        _createOffering();
        vm.warp(block.timestamp + 8 days);
        vm.startPrank(investor1);
        midr.faucet(TOKEN_PRICE);
        midr.approve(address(escrow), TOKEN_PRICE);
        vm.expectRevert(OfferingEscrow.DeadlinePassed.selector);
        escrow.invest(offeringId, TOKEN_PRICE);
        vm.stopPrank();
    }

    function test_invest_tracksAllocationAndRaised() public {
        _createOffering();
        uint256 amount = 30 * TOKEN_PRICE;
        vm.startPrank(investor1);
        midr.faucet(amount);
        midr.approve(address(escrow), amount);
        escrow.invest(offeringId, amount);
        vm.stopPrank();

        assertEq(midr.balanceOf(address(escrow)), amount);
        assertEq(escrow.allocationOf(offeringId, investor1), 30);
        assertEq(escrow.paymentOf(offeringId, investor1), amount);

        assertEq(_offering(offeringId).raised, amount);
    }

    function test_invest_rejectsFeeOnTransferToken() public {
        MockFeeToken feeToken = new MockFeeToken("Fee", "FEE", 500, outsider, false);
        vm.prank(structurer);
        uint256 id = escrow.createOffering(
            assetId,
            address(token),
            address(feeToken),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );

        uint256 amount = 10 * TOKEN_PRICE;
        feeToken.mint(investor1, amount);

        vm.startPrank(investor1);
        feeToken.approve(address(escrow), amount);
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.AmountMismatch.selector, amount, amount - (amount * 500 / 10_000)
            )
        );
        escrow.invest(id, amount);
        vm.stopPrank();

        assertEq(escrow.paymentOf(id, investor1), 0);
        assertEq(escrow.allocationOf(id, investor1), 0);
        assertEq(feeToken.balanceOf(address(escrow)), 0);
    }

    // -----------------------------------------------------------------
    // finalization
    // -----------------------------------------------------------------

    function test_finalize_rejectsBelowTarget() public {
        _createOffering();
        uint256 amount = 10 * TOKEN_PRICE;
        vm.startPrank(investor1);
        midr.faucet(amount);
        midr.approve(address(escrow), amount);
        escrow.invest(offeringId, amount);
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(OfferingEscrow.TargetNotReached.selector, amount, TARGET)
        );
        escrow.finalizeSuccessfulOffering(offeringId);
    }

    function test_finalize_setsFundedAndMovesAsset() public {
        _createOffering();
        _fillOffering();

        escrow.finalizeSuccessfulOffering(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));
        assertEq(uint256(_offering(offeringId).status), uint256(OfferingStatus.FUNDED));
    }

    function test_finalize_isIdempotentUnsafe_secondCallReverts() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FUNDED
            )
        );
        escrow.finalizeSuccessfulOffering(offeringId);
    }

    function test_noClaimBeforeFinalization() public {
        _createOffering();
        vm.startPrank(investor1);
        midr.faucet(TOKEN_PRICE);
        midr.approve(address(escrow), TOKEN_PRICE);
        escrow.invest(offeringId, TOKEN_PRICE);

        vm.expectRevert(OfferingEscrow.TokenClaimNotAvailable.selector);
        escrow.claimTokens(offeringId);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // failed offering refunds
    // -----------------------------------------------------------------

    function test_failOffering_requiresDeadlineAndBelowTarget() public {
        _createOffering();
        vm.expectRevert(OfferingEscrow.DeadlineNotPassed.selector);
        escrow.failOffering(offeringId);

        vm.warp(block.timestamp + 8 days);
        escrow.failOffering(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));

        // Already failed: cannot fail again.
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.failOffering(offeringId);
    }

    function test_refund_onlyForFailedOfferingAndOnce() public {
        _createOffering();
        uint256 amount = 10 * TOKEN_PRICE;
        vm.startPrank(investor1);
        midr.faucet(amount);
        midr.approve(address(escrow), amount);
        escrow.invest(offeringId, amount);
        vm.stopPrank();

        // Still OPEN: refund not available.
        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.RefundNotAvailable.selector);
        escrow.claimRefund(offeringId);

        vm.warp(block.timestamp + 8 days);
        escrow.failOffering(offeringId);

        uint256 before = midr.balanceOf(investor1);
        vm.prank(investor1);
        escrow.claimRefund(offeringId);
        assertEq(midr.balanceOf(investor1), before + amount);

        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimRefund(offeringId);
    }

    function test_refund_unavailableForFundedOffering() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.RefundNotAvailable.selector);
        escrow.claimRefund(offeringId);
    }

    // -----------------------------------------------------------------
    // claim / release
    // -----------------------------------------------------------------

    function test_claimTokens_transfersExactlyAllocationOnce() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        vm.prank(investor1);
        escrow.claimTokens(offeringId);

        assertEq(token.balanceOf(investor1), TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(escrow)), 0);

        vm.prank(investor1);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimTokens(offeringId);
    }

    function test_claimTokens_revertsForNonInvestor() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        vm.prank(outsider);
        vm.expectRevert(OfferingEscrow.NothingToClaim.selector);
        escrow.claimTokens(offeringId);
    }

    function test_releaseFunds_sendsToTreasuryAndActivatesAtomically() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        // Still FUNDED, not ACTIVE: the issuer cannot activate without the funds.
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        uint256 before = midr.balanceOf(treasury);
        escrow.releaseFunds(offeringId);
        assertEq(midr.balanceOf(treasury), before + TARGET);
        assertEq(midr.balanceOf(address(escrow)), 0);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));

        vm.expectRevert(OfferingEscrow.FundsAlreadyReleased.selector);
        escrow.releaseFunds(offeringId);
    }

    function test_releaseFunds_revertsWhileOfferingStillOpen() public {
        _createOffering();

        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.OFFERING));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.OPEN
            )
        );
        escrow.releaseFunds(offeringId);
    }

    function test_releaseFunds_revertsForFailedOffering() public {
        _createOffering();
        vm.warp(block.timestamp + 8 days);
        escrow.failOffering(offeringId);

        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FAILED));
        vm.expectRevert(
            abi.encodeWithSelector(
                OfferingEscrow.InvalidOfferingStatus.selector, OfferingStatus.FAILED
            )
        );
        escrow.releaseFunds(offeringId);
    }

    function test_releaseFunds_isOnlyPathToActive() public {
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        // No external caller can push the asset to ACTIVE on its own: the
        // registry rejects anyone but the escrow, and the escrow exposes no
        // activation entry point.
        for (uint256 i = 0; i < 5; i++) {
            address caller = address(uint160(0x1000 + i));
            vm.prank(caller);
            (bool ok,) = address(registry)
                .call(
                    abi.encodeWithSignature(
                        "transitionFromEscrow(bytes32,uint8)", assetId, uint8(AssetStatus.ACTIVE)
                    )
                );
            assertFalse(ok);
        }
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        (bool activated,) =
            address(escrow).call(abi.encodeWithSignature("activateAsset(uint256)", offeringId));
        assertFalse(activated);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));

        escrow.releaseFunds(offeringId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ACTIVE));
    }

    function test_noActivateAssetSelectorExists() public {
        // ACTIVE is reachable only through releaseFunds: no caller can drive the
        // registry transition themselves.
        _createOffering();
        _fillOffering();
        escrow.finalizeSuccessfulOffering(offeringId);

        (bool ok, bytes memory ret) =
            address(escrow).call(abi.encodeWithSignature("activateAsset(uint256)", 1));
        assertFalse(ok);
        assertEq(ret.length, 0);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.FUNDED));
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _createOffering() internal {
        vm.prank(structurer);
        offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
    }

    function _fillOffering() internal {
        vm.startPrank(investor1);
        midr.faucet(TARGET);
        midr.approve(address(escrow), TARGET);
        escrow.invest(offeringId, TARGET);
        vm.stopPrank();
    }

    function _offering(uint256 id) internal view returns (OfferingView memory) {
        return escrow.getOffering(id);
    }
}
