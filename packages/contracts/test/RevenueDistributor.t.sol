// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AttestationType} from "../src/ArchpropInterfaces.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title RevenueDistributorTest
 * @notice Covers the pro-rata accounting invariants: the split must always be
 *         `balance * amount / totalSupply`, evidence hashes are single-use, and
 *         only dust may leave a closed epoch.
 */
contract RevenueDistributorTest is BaseTest {
    PropertyToken internal token;
    uint256 internal epochId;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
        _activate();
    }

    // -----------------------------------------------------------------
    // publishRevenue
    // -----------------------------------------------------------------

    function test_publishRevenue_requiresAdmin() public {
        vm.prank(structurer);
        vm.expectRevert();
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
    }

    function test_publishRevenue_rejectsUnattestedAmount() public {
        // No REVENUE attestation exists yet at all.
        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(RevenueDistributor.RevenueAttestationInvalid.selector);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();

        // The attestation must match the deposited amount exactly.
        _attestRevenue(9999);
        vm.startPrank(admin);
        midr.faucet(9999);
        midr.approve(address(distributor), 9999);
        vm.expectRevert(RevenueDistributor.RevenueAttestationInvalid.selector);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    function test_publishRevenue_rejectsEvidenceReplay() public {
        epochId = _publish(5000);
        vm.warp(block.timestamp + 4 days);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        // Same evidence hash, a second epoch: refused.
        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevenueDistributor.EvidenceHashAlreadyUsed.selector, revenueEvidence
            )
        );
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    function test_publishRevenue_rejectsUnlinkedToken() public {
        _attestRevenue(5000);

        PropertyToken rogue = new PropertyToken(
            "Rogue",
            "ROG",
            keccak256("ASSET-ROGUE"),
            TOKEN_SUPPLY,
            address(identity),
            address(escrow),
            address(distributor)
        );
        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(RevenueDistributor.TokenNotLinkedToAsset.selector);
        distributor.publishRevenue(
            assetId,
            address(rogue),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    function test_publishRevenue_rejectsTokenWiredToForeignDistributor() public {
        bytes32 otherAssetId = keccak256("ARCHPROP-FOREIGN-DIST");
        address foreignDistributor = makeAddr("foreignDistributor");
        PropertyToken foreignToken = new PropertyToken(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            otherAssetId,
            TOKEN_SUPPLY,
            address(identity),
            address(escrow),
            foreignDistributor
        );
        _driveAssetToIssuanceReadyIn(registry, otherAssetId, foreignToken);
        _linkTokenIn(registry, otherAssetId, foreignToken);

        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevenueDistributor.TokenRevenueDistributorMismatch.selector,
                address(distributor),
                foreignDistributor
            )
        );
        distributor.publishRevenue(
            otherAssetId,
            address(foreignToken),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    function test_publishRevenue_rejectsPastDeadline() public {
        _attestRevenue(5000);
        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(RevenueDistributor.InvalidDeadline.selector);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp - 1)
        );
        vm.stopPrank();
    }

    function test_publishRevenue_pullsExactlyTheDepositedAmount() public {
        _attestRevenue(5000);

        vm.startPrank(admin);
        midr.faucet(10_000);
        midr.approve(address(distributor), 10_000);
        epochId = distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();

        assertEq(midr.balanceOf(address(distributor)), 5000);
        assertEq(epochId, 1);
    }

    // -----------------------------------------------------------------
    // claimRevenue
    // -----------------------------------------------------------------

    function test_claimRevenue_isProRataAndOneTime() public {
        epochId = _publish(5000);

        uint256 before = midr.balanceOf(investor1);
        vm.prank(investor1);
        distributor.claimRevenue(epochId);

        // investor1 holds 100% of supply, so it takes the whole epoch.
        assertEq(midr.balanceOf(investor1), before + 5000);

        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.AlreadyClaimed.selector);
        distributor.claimRevenue(epochId);
    }

    function test_claimRevenue_splitsAcrossHolders() public {
        // Split supply 75/25, then publish one epoch.
        vm.prank(investor1);
        token.transfer(investor2, TOKEN_SUPPLY / 4);

        epochId = _publish(5000);

        uint256 bal1 = midr.balanceOf(investor1);
        uint256 bal2 = midr.balanceOf(investor2);

        vm.prank(investor1);
        distributor.claimRevenue(epochId);
        vm.prank(investor2);
        distributor.claimRevenue(epochId);

        assertEq(midr.balanceOf(investor1), bal1 + 3750);
        assertEq(midr.balanceOf(investor2), bal2 + 1250);
    }

    function test_claimRevenue_revertsWithNoBalance() public {
        epochId = _publish(5000);

        vm.prank(outsider);
        vm.expectRevert(RevenueDistributor.NothingToClaim.selector);
        distributor.claimRevenue(epochId);
    }

    function test_claimRevenue_revertsAfterDeadline() public {
        epochId = _publish(5000);
        vm.warp(block.timestamp + 4 days);

        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.DeadlineNotPassed.selector);
        distributor.claimRevenue(epochId);
    }

    function test_claimRevenue_revertsForUnknownEpoch() public {
        vm.prank(investor1);
        vm.expectRevert(RevenueDistributor.EpochNotFound.selector);
        distributor.claimRevenue(999);
    }

    // -----------------------------------------------------------------
    // closeRevenueEpoch
    // -----------------------------------------------------------------

    function test_closeEpoch_returnsDustAndLocksClaims() public {
        // Two holders, one of which never claims: the dust returns to the funder.
        vm.prank(investor1);
        token.transfer(investor2, TOKEN_SUPPLY / 2);

        epochId = _publish(5000);

        vm.prank(investor1);
        distributor.claimRevenue(epochId);
        assertEq(midr.balanceOf(address(distributor)), 2500);

        vm.warp(block.timestamp + 4 days);
        uint256 funderBefore = midr.balanceOf(admin);
        vm.prank(admin);
        distributor.closeRevenueEpoch(epochId);

        assertEq(midr.balanceOf(admin), funderBefore + 2500);
        assertEq(midr.balanceOf(address(distributor)), 0);

        // No further claims.
        vm.prank(investor2);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.claimRevenue(epochId);

        // And no double close.
        vm.prank(admin);
        vm.expectRevert(RevenueDistributor.EpochClosed.selector);
        distributor.closeRevenueEpoch(epochId);
    }

    function test_closeEpoch_requiresDeadlinePassed() public {
        epochId = _publish(5000);

        vm.prank(admin);
        vm.expectRevert(RevenueDistributor.DeadlineNotPassed.selector);
        distributor.closeRevenueEpoch(epochId);
    }

    function test_closeEpoch_requiresAdmin() public {
        epochId = _publish(5000);
        vm.warp(block.timestamp + 4 days);

        vm.prank(outsider);
        vm.expectRevert();
        distributor.closeRevenueEpoch(epochId);
    }

    // -----------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------

    function _activate() internal {
        uint256 id = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(id);
        escrow.releaseFunds(id);
    }

    function _attestRevenue(uint256 amount) internal {
        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, amount);
    }

    function _publish(uint256 amount) internal returns (uint256) {
        _attestRevenue(amount);
        vm.startPrank(admin);
        midr.faucet(amount);
        midr.approve(address(distributor), amount);
        uint256 id = distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            amount,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
        return id;
    }
}

/**
 * @title UnclaimedSupplyTest
 * @notice A funded offering whose tokens were never claimed leaves the whole
 *         supply in the escrow, so revenue publication must refuse it: the
 *         pro-rata split would otherwise be computed against owners who do not
 *         exist yet.
 */
contract UnclaimedSupplyTest is BaseTest {
    PropertyToken internal token;

    function setUp() public override {
        super.setUp();
        token = _deployToken();
        _toIssuanceReady(token);
    }

    function test_publishRevenue_rejectsWhenEscrowStillHoldsTokens() public {
        _createFundedOffering(token);
        escrow.releaseFunds(1);

        assertEq(token.balanceOf(address(escrow)), TOKEN_SUPPLY);

        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, 5000);

        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        vm.expectRevert(
            abi.encodeWithSelector(RevenueDistributor.EscrowHoldsTokens.selector, TOKEN_SUPPLY)
        );
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }

    function test_claimingThenPublishingSucceeds() public {
        uint256 id = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(id);
        escrow.releaseFunds(id);

        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, 5000);

        vm.startPrank(admin);
        midr.faucet(5000);
        midr.approve(address(distributor), 5000);
        distributor.publishRevenue(
            assetId,
            address(token),
            address(midr),
            5000,
            revenueEvidence,
            uint64(block.timestamp + 3 days)
        );
        vm.stopPrank();
    }
}
