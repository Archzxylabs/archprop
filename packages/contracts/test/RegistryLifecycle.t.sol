// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    AssetStatus,
    AssetView,
    AttestationType,
    Attestation,
    IArchpropRegistry,
    IPropertyToken
} from "../src/ArchpropInterfaces.sol";
import {ArchpropRegistry} from "../src/ArchpropRegistry.sol";
import {PropertyToken} from "../src/PropertyToken.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * @title RegistryLifecycleTest
 * @notice Covers the "no verification, no issuance" invariant and the
 *         role/status gates on every lifecycle transition.
 */
contract RegistryLifecycleTest is BaseTest {
    // -----------------------------------------------------------------
    // createAsset
    // -----------------------------------------------------------------

    function test_createAsset_startsSubmitted_withOwner() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);

        AssetView memory a = registry.getAsset(assetId);
        assertEq(uint256(a.status), uint256(AssetStatus.SUBMITTED));
        assertEq(a.owner, issuer);
        assertEq(a.metadataHash, metadataHash);
        assertEq(a.agreementHash, bytes32(0));
        assertEq(a.token, address(0));
    }

    function test_createAsset_revertsOnZeroId() public {
        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.InvalidAssetId.selector);
        registry.createAsset(bytes32(0), metadataHash);
    }

    function test_createAsset_revertsOnZeroMetadata() public {
        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.InvalidMetadataHash.selector);
        registry.createAsset(assetId, bytes32(0));
    }

    function test_createAsset_revertsOnDuplicate() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.AssetAlreadyExists.selector);
        registry.createAsset(assetId, metadataHash);
    }

    // -----------------------------------------------------------------
    // beginVerification
    // -----------------------------------------------------------------

    function test_beginVerification_ownerOnly() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);

        vm.prank(outsider);
        vm.expectRevert(ArchpropRegistry.NotAssetOwner.selector);
        registry.beginVerification(assetId);

        vm.prank(issuer);
        registry.beginVerification(assetId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.UNDER_VERIFICATION));
    }

    function test_beginVerification_revertsWhenNotSubmitted() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.UNDER_VERIFICATION
            )
        );
        registry.beginVerification(assetId);
    }

    // -----------------------------------------------------------------
    // submitAttestation
    // -----------------------------------------------------------------

    function test_attestation_appendsAndKeepsHistory() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);

        // A second ownership attestation must not silently replace the first.
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, keccak256("second"), 0);

        assertEq(registry.attestationCount(assetId, AttestationType.OWNERSHIP), 2);
        Attestation memory first = registry.getAttestation(assetId, AttestationType.OWNERSHIP, 0);
        assertEq(first.evidenceHash, ownershipEvidence);
        assertEq(first.verifier, legalVerifier);
        assertTrue(first.valid);
    }

    function test_attestation_ownerCannotSelfAttest_evenWithRole() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.startPrank(admin);
        registry.grantRole(registry.LEGAL_VERIFIER_ROLE(), issuer);
        registry.grantRole(registry.VALUATION_VERIFIER_ROLE(), issuer);
        registry.grantRole(registry.REVENUE_VERIFIER_ROLE(), issuer);
        vm.stopPrank();

        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.OwnerCannotSelfAttest.selector);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);

        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.OwnerCannotSelfAttest.selector);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);

        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.OwnerCannotSelfAttest.selector);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, 1 ether);
    }

    function test_attestation_requiresRole() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.MissingRole.selector, registry.LEGAL_VERIFIER_ROLE()
            )
        );
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.MissingRole.selector, registry.VALUATION_VERIFIER_ROLE()
            )
        );
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);
    }

    function test_attestation_ownershipRequiresZeroValue() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(legalVerifier);
        vm.expectRevert(ArchpropRegistry.InvalidAttestationValue.selector);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 1);
    }

    function test_attestation_valuationRequiresNonzeroValue() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(valuationVerifier);
        vm.expectRevert(ArchpropRegistry.InvalidAttestationValue.selector);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, 0);
    }

    function test_attestation_rejectsZeroEvidenceHash() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(legalVerifier);
        vm.expectRevert(ArchpropRegistry.InvalidEvidenceHash.selector);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, bytes32(0), 0);
    }

    function test_attestation_onlyInCorrectStatus() public {
        // Before verification begins, ownership is not accepted.
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(legalVerifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.SUBMITTED
            )
        );
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);

        vm.prank(issuer);
        registry.beginVerification(assetId);

        // REVENUE requires ACTIVE, not UNDER_VERIFICATION.
        vm.prank(revenueVerifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.UNDER_VERIFICATION
            )
        );
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, 1 ether);
    }

    // -----------------------------------------------------------------
    // finalizeVerification
    // -----------------------------------------------------------------

    function test_finalizeVerification_requiresBothAttestations() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        // Ownership alone is not enough.
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.MissingValuationAttestation.selector);
        registry.finalizeVerification(assetId);

        // Valuation alone is not enough.
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);
        vm.prank(issuer);
        registry.finalizeVerification(assetId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.VERIFIED));
    }

    function test_finalizeVerification_missingOwnership() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);

        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.MissingOwnershipAttestation.selector);
        registry.finalizeVerification(assetId);
    }

    function test_finalizeVerification_ownerOnly() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);

        vm.prank(outsider);
        vm.expectRevert(ArchpropRegistry.NotAssetOwner.selector);
        registry.finalizeVerification(assetId);
    }

    // -----------------------------------------------------------------
    // agreement / issuance ready
    // -----------------------------------------------------------------

    function test_registerAgreement_requiresStructurerAndVerified() public {
        _toIssuanceReady(_deployToken());

        // Already ISSUANCE_READY: cannot re-register.
        vm.prank(structurer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.ISSUANCE_READY
            )
        );
        registry.registerAgreement(assetId, keccak256("other"));

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.MissingRole.selector, registry.STRUCTURER_ROLE()
            )
        );
        registry.registerAgreement(assetId, keccak256("other"));
    }

    function test_markIssuanceReady_requiresAgreement() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);
        vm.prank(issuer);
        registry.finalizeVerification(assetId);

        vm.prank(structurer);
        vm.expectRevert(ArchpropRegistry.MissingAgreement.selector);
        registry.markIssuanceReady(assetId);

        vm.prank(structurer);
        registry.registerAgreement(assetId, agreementHash);
        vm.prank(structurer);
        registry.markIssuanceReady(assetId);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ISSUANCE_READY));
        assertEq(registry.assetAgreementHash(assetId), agreementHash);
    }

    // -----------------------------------------------------------------
    // linkToken
    // -----------------------------------------------------------------

    function test_linkToken_onlyInIssuanceReady() public {
        PropertyToken token = _deployToken();

        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);

        vm.prank(structurer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.SUBMITTED
            )
        );
        registry.linkToken(assetId, address(token));
    }

    function test_linkToken_rejectsMismatchedAssetId() public {
        PropertyToken wrong = new PropertyToken(
            "Wrong",
            "WRG",
            keccak256("OTHER"),
            TOKEN_SUPPLY,
            address(identity),
            address(escrow),
            address(distributor)
        );

        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);
        vm.prank(issuer);
        registry.finalizeVerification(assetId);
        vm.prank(structurer);
        registry.registerAgreement(assetId, agreementHash);
        vm.prank(structurer);
        registry.markIssuanceReady(assetId);

        vm.prank(structurer);
        vm.expectRevert(ArchpropRegistry.TokenAssetIdMismatch.selector);
        registry.linkToken(assetId, address(wrong));
    }

    function test_linkToken_rejectsWhenEscrowMismatched() public {
        PropertyToken token = _deployToken();
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);
        vm.prank(legalVerifier);
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(valuationVerifier);
        registry.submitAttestation(assetId, AttestationType.VALUATION, valuationEvidence, TARGET);
        vm.prank(issuer);
        registry.finalizeVerification(assetId);
        vm.prank(structurer);
        registry.registerAgreement(assetId, agreementHash);
        vm.prank(structurer);
        registry.markIssuanceReady(assetId);

        // A token whose own escrow is not this registry's escrow.
        PropertyToken stray = new PropertyToken(
            "Stray",
            "STR",
            assetId,
            TOKEN_SUPPLY,
            address(identity),
            address(0xdead),
            address(distributor)
        );
        vm.prank(structurer);
        vm.expectRevert(ArchpropRegistry.EscrowNotConfigured.selector);
        registry.linkToken(assetId, address(stray));
    }

    function test_linkToken_cannotBeReplaced() public {
        PropertyToken token = _deployToken();
        _toIssuanceReady(token);

        vm.prank(structurer);
        vm.expectRevert(ArchpropRegistry.TokenAlreadyLinked.selector);
        registry.linkToken(assetId, address(token));
    }

    // -----------------------------------------------------------------
    // rejectAsset
    // -----------------------------------------------------------------

    function test_rejectAsset_isTerminal() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(legalVerifier);
        registry.rejectAsset(assetId, AttestationType.OWNERSHIP, ownershipEvidence);
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.REJECTED));

        // No further attestation and no finalization is possible.
        vm.prank(legalVerifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.REJECTED
            )
        );
        registry.submitAttestation(assetId, AttestationType.OWNERSHIP, ownershipEvidence, 0);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.REJECTED
            )
        );
        registry.finalizeVerification(assetId);
    }

    function test_rejectAsset_requiresRoleAndValidKind() public {
        vm.prank(issuer);
        registry.createAsset(assetId, metadataHash);
        vm.prank(issuer);
        registry.beginVerification(assetId);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.MissingRole.selector, registry.LEGAL_VERIFIER_ROLE()
            )
        );
        registry.rejectAsset(assetId, AttestationType.OWNERSHIP, ownershipEvidence);

        vm.prank(revenueVerifier);
        vm.expectRevert(ArchpropRegistry.UnsupportedRejectionType.selector);
        registry.rejectAsset(assetId, AttestationType.REVENUE, revenueEvidence);
    }

    // -----------------------------------------------------------------
    // escrow-only transitions
    // -----------------------------------------------------------------

    function test_transitionFromEscrow_onlyEscrowCanCall() public {
        PropertyToken token = _deployToken();
        _toIssuanceReady(token);

        vm.prank(admin);
        vm.expectRevert(ArchpropRegistry.NotConfiguredEscrow.selector);
        registry.transitionFromEscrow(assetId, AssetStatus.OFFERING);

        vm.prank(issuer);
        vm.expectRevert(ArchpropRegistry.NotConfiguredEscrow.selector);
        registry.transitionFromEscrow(assetId, AssetStatus.OFFERING);
    }

    function test_transitionFromEscrow_rejectsBackwardsOrIllegalStates() public {
        PropertyToken token = _deployToken();
        _toIssuanceReady(token);

        // Not yet OFFERING, so FUNDED is illegal.
        vm.prank(address(escrow));
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.InvalidAssetStatus.selector, AssetStatus.ISSUANCE_READY
            )
        );
        registry.transitionFromEscrow(assetId, AssetStatus.FUNDED);

        // The escrow cannot reach VERIFIED or ISSUANCE_READY at all.
        vm.prank(address(escrow));
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.UnauthorizedTransition.selector, AssetStatus.VERIFIED
            )
        );
        registry.transitionFromEscrow(assetId, AssetStatus.VERIFIED);

        vm.prank(address(escrow));
        vm.expectRevert(
            abi.encodeWithSelector(
                ArchpropRegistry.UnauthorizedTransition.selector, AssetStatus.ISSUANCE_READY
            )
        );
        registry.transitionFromEscrow(assetId, AssetStatus.ISSUANCE_READY);
    }

    function test_noAdminPathToOffering() public {
        PropertyToken token = _deployToken();
        _toIssuanceReady(token);

        // An admin (DEFAULT_ADMIN_ROLE holder) has no lifecycle function at all.
        vm.prank(admin);
        vm.expectRevert(ArchpropRegistry.NotConfiguredEscrow.selector);
        registry.transitionFromEscrow(assetId, AssetStatus.OFFERING);

        // And there is no admin setter for status.
        assertEq(uint256(registry.assetStatus(assetId)), uint256(AssetStatus.ISSUANCE_READY));
    }

    function test_setEscrow_isOneTimeAdminOnly() public {
        vm.prank(admin);
        vm.expectRevert(ArchpropRegistry.EscrowAlreadyConfigured.selector);
        registry.setEscrow(address(escrow));

        vm.prank(outsider);
        vm.expectRevert();
        registry.setEscrow(makeAddr("other"));
    }

    // -----------------------------------------------------------------
    // revenue attestation view
    // -----------------------------------------------------------------

    function test_isRevenueAttestationValid_requiresActiveAndExactMatch() public {
        assertFalse(registry.isRevenueAttestationValid(assetId, revenueEvidence, 1000));

        PropertyToken token = _deployToken();
        _toIssuanceReady(token);
        uint256 offeringId = _createFundedOffering(token);
        vm.prank(investor1);
        escrow.claimTokens(offeringId);
        escrow.releaseFunds(offeringId);

        // Not yet attested.
        assertFalse(registry.isRevenueAttestationValid(assetId, revenueEvidence, 1000));

        vm.prank(revenueVerifier);
        registry.submitAttestation(assetId, AttestationType.REVENUE, revenueEvidence, 1000);

        assertTrue(registry.isRevenueAttestationValid(assetId, revenueEvidence, 1000));
        assertFalse(registry.isRevenueAttestationValid(assetId, revenueEvidence, 999));
        assertFalse(registry.isRevenueAttestationValid(assetId, keccak256("other"), 1000));
        assertFalse(registry.isRevenueAttestationValid(assetId, revenueEvidence, 0));
        assertFalse(registry.isRevenueAttestationValid(keccak256("MISSING"), revenueEvidence, 1000));
    }
}
