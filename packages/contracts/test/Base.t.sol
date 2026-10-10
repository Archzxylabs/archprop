// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {
    AssetStatus,
    AttestationType,
    OfferingStatus,
    IArchpropRegistry,
    IPropertyToken,
    IOfferingEscrow,
    IRevenueDistributor
} from "../src/ArchpropInterfaces.sol";
import {ArchpropRegistry} from "../src/ArchpropRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {MockIDR} from "../src/MockIDR.sol";
import {OfferingEscrow} from "../src/OfferingEscrow.sol";
import {RevenueDistributor} from "../src/RevenueDistributor.sol";

/**
 * @title Base
 * @notice Shared fixture mirroring the reference lifecycle in
 *         `docs/INTERFACES.md`: 3,000,000,000 mIDR target, 300,000 AVNUSA
 *         supply, 10,000 mIDR per token.
 */
contract BaseTest is Test {
    ArchpropRegistry internal registry;
    IdentityRegistry internal identity;
    MockIDR internal midr;
    OfferingEscrow internal escrow;
    RevenueDistributor internal distributor;

    address internal admin = makeAddr("admin");
    address internal structurer = makeAddr("structurer");
    address internal issuer = makeAddr("issuer");
    address internal treasury = makeAddr("treasury");
    address internal legalVerifier = makeAddr("legalVerifier");
    address internal valuationVerifier = makeAddr("valuationVerifier");
    address internal revenueVerifier = makeAddr("revenueVerifier");
    address internal investor1 = makeAddr("investor1");
    address internal investor2 = makeAddr("investor2");
    address internal outsider = makeAddr("outsider");

    bytes32 internal assetId = keccak256("ARCHPROP-001");
    bytes32 internal metadataHash = keccak256("metadata");
    bytes32 internal agreementHash = keccak256("agreement");
    bytes32 internal ownershipEvidence = keccak256("ownership-evidence");
    bytes32 internal valuationEvidence = keccak256("valuation-evidence");
    bytes32 internal revenueEvidence = keccak256("revenue-evidence");

    string internal constant TOKEN_NAME = "Archprop Villa Nusa";
    string internal constant TOKEN_SYMBOL = "AVNUSA";
    uint256 internal constant TOKEN_SUPPLY = 300_000;
    uint256 internal constant TOKEN_PRICE = 10_000;
    uint256 internal constant TARGET = 3_000_000_000;

    function setUp() public virtual {
        registry = new ArchpropRegistry(admin);
        identity = new IdentityRegistry(admin);
        distributor = new RevenueDistributor(admin, address(registry));
        escrow = new OfferingEscrow(admin, address(registry), address(identity));

        vm.startPrank(admin);
        registry.setEscrow(address(escrow));
        registry.grantRole(registry.STRUCTURER_ROLE(), structurer);
        registry.grantRole(registry.LEGAL_VERIFIER_ROLE(), legalVerifier);
        registry.grantRole(registry.VALUATION_VERIFIER_ROLE(), valuationVerifier);
        registry.grantRole(registry.REVENUE_VERIFIER_ROLE(), revenueVerifier);
        escrow.grantRole(escrow.STRUCTURER_ROLE(), structurer);
        vm.stopPrank();

        // The distributor must be known to the token, and the escrow to the
        // distributor, so both are wired before any token exists.
        vm.startPrank(admin);
        identity.setInvestorApproval(investor1, true);
        identity.setInvestorApproval(investor2, true);
        vm.stopPrank();

        midr = new MockIDR(admin);
    }

    /// @dev Deploys the token with `distributor` and `escrow` wired in.
    function _deployToken() internal returns (PropertyToken) {
        return new PropertyToken(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            assetId,
            TOKEN_SUPPLY,
            address(identity),
            address(escrow),
            address(distributor)
        );
    }

    /// @dev Drives `id` from `SUBMITTED` to `ISSUANCE_READY` and links `token`.
    function _toIssuanceReady(PropertyToken token) internal {
        _driveAssetToIssuanceReadyIn(registry, assetId, token);
        _linkTokenIn(registry, assetId, token);
    }

    /// @dev Drives an arbitrary asset from `SUBMITTED` to `ISSUANCE_READY` in `reg`. Does not link the token.
    function _driveAssetToIssuanceReadyIn(ArchpropRegistry reg, bytes32 id, PropertyToken token)
        internal
    {
        vm.prank(issuer);
        reg.createAsset(id, metadataHash);
        vm.prank(issuer);
        reg.beginVerification(id);
        vm.prank(legalVerifier);
        reg.submitAttestation(id, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(valuationVerifier);
        reg.submitAttestation(id, AttestationType.VALUATION, valuationEvidence, TARGET);
        vm.prank(issuer);
        reg.finalizeVerification(id);
        vm.prank(structurer);
        reg.registerAgreement(id, agreementHash);
        vm.prank(structurer);
        reg.markIssuanceReady(id);
    }

    /// @dev Links `token` to `id` in `reg`.
    function _linkTokenIn(ArchpropRegistry reg, bytes32 id, PropertyToken token) internal {
        vm.prank(structurer);
        reg.linkToken(id, address(token));
    }

    /// @dev Creates and funds an offering to completion.
    function _createFundedOffering(PropertyToken token) internal returns (uint256 offeringId) {
        vm.startPrank(structurer);
        offeringId = escrow.createOffering(
            assetId,
            address(token),
            address(midr),
            TARGET,
            TOKEN_PRICE,
            uint64(block.timestamp + 7 days),
            treasury
        );
        vm.stopPrank();

        vm.startPrank(investor1);
        midr.faucet(TARGET);
        midr.approve(address(escrow), TARGET);
        escrow.invest(offeringId, TARGET);
        vm.stopPrank();

        escrow.finalizeSuccessfulOffering(offeringId);
    }
}
