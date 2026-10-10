// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    AssetStatus,
    AttestationType,
    AssetView,
    Attestation,
    IArchpropRegistry,
    IPropertyToken
} from "./ArchpropInterfaces.sol";

/**
 * @title ArchpropRegistry
 * @notice Lifecycle and attestation authority for ARCHPROP.
 *
 * @dev Core invariant: **No verification, no issuance.**
 *
 *      - `createAsset` always starts at `SUBMITTED`; there is no on-chain draft
 *        state and therefore no privileged draft-to-issued bypass.
 *      - Only the asset owner may move `SUBMITTED -> UNDER_VERIFICATION`.
 *      - An asset owner can never attest to their own asset, even when they hold
 *        a verifier role.
 *      - `VERIFIED` requires a valid OWNERSHIP and a valid VALUATION attestation.
 *      - `ISSUANCE_READY` additionally requires a registered agreement hash.
 *      - A token may be linked only at `ISSUANCE_READY`, only when its own
 *        `assetId` matches and only when its escrow is the registry's escrow.
 *      - `OFFERING`, `FUNDED`, `FAILED` and `ACTIVE` are reachable *only*
 *        through `transitionFromEscrow`, which only the configured
 *        `OfferingEscrow` may call, and only along the single permitted edge.
 *        There is no admin lifecycle shortcut.
 */
contract ArchpropRegistry is AccessControl, IArchpropRegistry {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    bytes32 public constant LEGAL_VERIFIER_ROLE = keccak256("LEGAL_VERIFIER_ROLE");
    bytes32 public constant VALUATION_VERIFIER_ROLE = keccak256("VALUATION_VERIFIER_ROLE");
    bytes32 public constant STRUCTURER_ROLE = keccak256("STRUCTURER_ROLE");
    bytes32 public constant REVENUE_VERIFIER_ROLE = keccak256("REVENUE_VERIFIER_ROLE");

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The only contract permitted to advance OFFERING/FUNDED/FAILED/ACTIVE.
    address public escrow;

    mapping(bytes32 => AssetView) private _assets;
    mapping(bytes32 => mapping(AttestationType => Attestation[])) private _attestations;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event AssetCreated(bytes32 indexed assetId, address indexed owner, bytes32 metadataHash);
    event AttestationSubmitted(
        bytes32 indexed assetId,
        AttestationType indexed kind,
        address indexed verifier,
        bytes32 evidenceHash,
        uint256 value
    );
    event AssetRejected(
        bytes32 indexed assetId,
        AttestationType indexed kind,
        address indexed verifier,
        bytes32 evidenceHash
    );
    event AssetVerified(bytes32 indexed assetId);
    event AgreementRegistered(bytes32 indexed assetId, bytes32 agreementHash);
    event TokenLinked(bytes32 indexed assetId, address indexed token);
    event AssetStatusChanged(bytes32 indexed assetId, AssetStatus from, AssetStatus to);
    event EscrowConfigured(address indexed escrow);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidAssetId();
    error InvalidMetadataHash();
    error InvalidEvidenceHash();
    error InvalidAgreementHash();
    error AssetNotFound();
    error AssetAlreadyExists();
    error NotAssetOwner();
    error OwnerCannotSelfAttest();
    error MissingRole(bytes32 role);
    error InvalidAssetStatus(AssetStatus current);
    error InvalidAttestationValue();
    error UnsupportedRejectionType();
    error MissingOwnershipAttestation();
    error MissingValuationAttestation();
    error MissingAgreement();
    error TokenAlreadyLinked();
    error TokenAssetIdMismatch();
    error EscrowAlreadyConfigured();
    error EscrowNotConfigured();
    error NotConfiguredEscrow();
    error UnauthorizedTransition(AssetStatus requested);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Asset lifecycle
    // ---------------------------------------------------------------------

    /// @notice Creates an asset record at `SUBMITTED` with `msg.sender` as owner.
    function createAsset(bytes32 assetId, bytes32 metadataHash) external {
        if (assetId == bytes32(0)) revert InvalidAssetId();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (_assets[assetId].owner != address(0)) revert AssetAlreadyExists();

        _assets[assetId] = AssetView({
            owner: msg.sender,
            metadataHash: metadataHash,
            agreementHash: bytes32(0),
            status: AssetStatus.SUBMITTED,
            token: address(0)
        });

        emit AssetCreated(assetId, msg.sender, metadataHash);
    }

    /// @notice Owner-only move from `SUBMITTED` to `UNDER_VERIFICATION`.
    function beginVerification(bytes32 assetId) external {
        AssetView storage a = _requireAsset(assetId);
        if (a.owner != msg.sender) revert NotAssetOwner();
        if (a.status != AssetStatus.SUBMITTED) revert InvalidAssetStatus(a.status);
        _setStatus(assetId, AssetStatus.UNDER_VERIFICATION);
    }

    /**
     * @notice Appends an attestation. Append-only; nothing can silently mutate.
     * @dev OWNERSHIP requires LEGAL_VERIFIER_ROLE and value 0, VALUATION requires
     *      VALUATION_VERIFIER_ROLE and a nonzero value, both only while
     *      UNDER_VERIFICATION. REVENUE requires REVENUE_VERIFIER_ROLE and a
     *      nonzero value, only while ACTIVE. The asset owner is always rejected,
     *      even when holding a matching verifier role.
     */
    function submitAttestation(
        bytes32 assetId,
        AttestationType kind,
        bytes32 evidenceHash,
        uint256 value
    ) external {
        AssetView storage a = _requireAsset(assetId);
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (a.owner == msg.sender) revert OwnerCannotSelfAttest();

        if (kind == AttestationType.OWNERSHIP) {
            if (!hasRole(LEGAL_VERIFIER_ROLE, msg.sender)) revert MissingRole(LEGAL_VERIFIER_ROLE);
            if (a.status != AssetStatus.UNDER_VERIFICATION) {
                revert InvalidAssetStatus(a.status);
            }
            if (value != 0) revert InvalidAttestationValue();
        } else if (kind == AttestationType.VALUATION) {
            if (!hasRole(VALUATION_VERIFIER_ROLE, msg.sender)) {
                revert MissingRole(VALUATION_VERIFIER_ROLE);
            }
            if (a.status != AssetStatus.UNDER_VERIFICATION) {
                revert InvalidAssetStatus(a.status);
            }
            if (value == 0) revert InvalidAttestationValue();
        } else {
            if (!hasRole(REVENUE_VERIFIER_ROLE, msg.sender)) {
                revert MissingRole(REVENUE_VERIFIER_ROLE);
            }
            if (a.status != AssetStatus.ACTIVE) revert InvalidAssetStatus(a.status);
            if (value == 0) revert InvalidAttestationValue();
        }

        _attestations[assetId][kind].push(
            Attestation({
                verifier: msg.sender,
                attestationType: kind,
                evidenceHash: evidenceHash,
                value: value,
                timestamp: uint64(block.timestamp),
                valid: true
            })
        );

        emit AttestationSubmitted(assetId, kind, msg.sender, evidenceHash, value);
    }

    /**
     * @notice Terminal rejection, callable only from `UNDER_VERIFICATION` by a
     *         role-matched legal (OWNERSHIP) or valuation (VALUATION) verifier.
     */
    function rejectAsset(bytes32 assetId, AttestationType kind, bytes32 evidenceHash) external {
        AssetView storage a = _requireAsset(assetId);
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (a.status != AssetStatus.UNDER_VERIFICATION) revert InvalidAssetStatus(a.status);

        if (kind == AttestationType.OWNERSHIP) {
            if (!hasRole(LEGAL_VERIFIER_ROLE, msg.sender)) {
                revert MissingRole(LEGAL_VERIFIER_ROLE);
            }
        } else if (kind == AttestationType.VALUATION) {
            if (!hasRole(VALUATION_VERIFIER_ROLE, msg.sender)) {
                revert MissingRole(VALUATION_VERIFIER_ROLE);
            }
        } else {
            revert UnsupportedRejectionType();
        }

        _setStatus(assetId, AssetStatus.REJECTED);
        emit AssetRejected(assetId, kind, msg.sender, evidenceHash);
    }

    /**
     * @notice Moves `UNDER_VERIFICATION -> VERIFIED` when a valid ownership and a
     *         valid valuation attestation both exist.
     */
    function finalizeVerification(bytes32 assetId) external {
        AssetView storage a = _requireAsset(assetId);
        if (a.owner != msg.sender) revert NotAssetOwner();
        if (a.status != AssetStatus.UNDER_VERIFICATION) revert InvalidAssetStatus(a.status);

        Attestation memory ownership = _latestAttestation(assetId, AttestationType.OWNERSHIP);
        if (ownership.verifier == address(0) || ownership.evidenceHash == bytes32(0)) {
            revert MissingOwnershipAttestation();
        }

        Attestation memory valuation = _latestAttestation(assetId, AttestationType.VALUATION);
        if (
            valuation.verifier == address(0) || valuation.evidenceHash == bytes32(0)
                || valuation.value == 0
        ) {
            revert MissingValuationAttestation();
        }

        _setStatus(assetId, AssetStatus.VERIFIED);
        emit AssetVerified(assetId);
    }

    /// @notice Registers the economic-rights agreement hash. Requires `VERIFIED`.
    function registerAgreement(bytes32 assetId, bytes32 agreementHash) external {
        if (!hasRole(STRUCTURER_ROLE, msg.sender)) revert MissingRole(STRUCTURER_ROLE);
        AssetView storage a = _requireAsset(assetId);
        if (agreementHash == bytes32(0)) revert InvalidAgreementHash();
        if (a.status != AssetStatus.VERIFIED) revert InvalidAssetStatus(a.status);

        a.agreementHash = agreementHash;
        emit AgreementRegistered(assetId, agreementHash);
    }

    /// @notice Moves `VERIFIED -> ISSUANCE_READY`. Requires a registered agreement.
    function markIssuanceReady(bytes32 assetId) external {
        if (!hasRole(STRUCTURER_ROLE, msg.sender)) revert MissingRole(STRUCTURER_ROLE);
        AssetView storage a = _requireAsset(assetId);
        if (a.status != AssetStatus.VERIFIED) revert InvalidAssetStatus(a.status);
        if (a.agreementHash == bytes32(0)) revert MissingAgreement();

        _setStatus(assetId, AssetStatus.ISSUANCE_READY);
    }

    /**
     * @notice Links the property token. Requires `ISSUANCE_READY` and validates
     *         that the token's own `assetId` matches and that the token's
     *         configured escrow is this registry's escrow.
     */
    function linkToken(bytes32 assetId, address token) external {
        if (!hasRole(STRUCTURER_ROLE, msg.sender)) revert MissingRole(STRUCTURER_ROLE);
        AssetView storage a = _requireAsset(assetId);
        if (token == address(0)) revert ZeroAddress();
        if (a.status != AssetStatus.ISSUANCE_READY) revert InvalidAssetStatus(a.status);
        if (a.token != address(0)) revert TokenAlreadyLinked();
        if (escrow == address(0)) revert EscrowNotConfigured();
        if (IPropertyToken(token).assetId() != assetId) revert TokenAssetIdMismatch();
        if (IPropertyToken(token).offeringEscrow() != escrow) revert EscrowNotConfigured();

        a.token = token;
        emit TokenLinked(assetId, token);
    }

    /// @notice Admin-only, one-time escrow configuration.
    function setEscrow(address escrow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (escrow_ == address(0)) revert ZeroAddress();
        if (escrow != address(0)) revert EscrowAlreadyConfigured();
        escrow = escrow_;
        emit EscrowConfigured(escrow_);
    }

    /**
     * @notice The only path into OFFERING, FUNDED, FAILED and ACTIVE.
     * @dev Callable only by the configured `OfferingEscrow`, and only along the
     *      single permitted edge for the requested target state. No admin,
     *      structurer or owner function may reach these states any other way.
     */
    function transitionFromEscrow(bytes32 assetId, AssetStatus status) external {
        if (escrow == address(0) || msg.sender != escrow) revert NotConfiguredEscrow();
        AssetView storage a = _requireAsset(assetId);

        AssetStatus current = a.status;
        if (status == AssetStatus.OFFERING) {
            if (current != AssetStatus.ISSUANCE_READY) revert InvalidAssetStatus(current);
        } else if (status == AssetStatus.FUNDED) {
            if (current != AssetStatus.OFFERING) revert InvalidAssetStatus(current);
        } else if (status == AssetStatus.FAILED) {
            if (current != AssetStatus.OFFERING) revert InvalidAssetStatus(current);
        } else if (status == AssetStatus.ACTIVE) {
            if (current != AssetStatus.FUNDED) revert InvalidAssetStatus(current);
        } else {
            revert UnauthorizedTransition(status);
        }

        _setStatus(assetId, status);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /**
     * @notice Validates a REVENUE attestation for a revenue publication.
     * @dev The asset must be `ACTIVE` and the latest REVENUE attestation must
     *      match both the evidence hash and the distributable amount exactly.
     *      Single-use enforcement of the evidence hash lives in
     *      `RevenueDistributor`.
     */
    function isRevenueAttestationValid(bytes32 assetId, bytes32 evidenceHash, uint256 amount)
        external
        view
        returns (bool)
    {
        AssetView storage a = _assets[assetId];
        if (a.owner == address(0)) return false;
        if (a.status != AssetStatus.ACTIVE) return false;
        if (evidenceHash == bytes32(0) || amount == 0) return false;

        Attestation memory revenue = _latestAttestation(assetId, AttestationType.REVENUE);
        if (revenue.verifier == address(0) || !revenue.valid) return false;
        if (revenue.evidenceHash != evidenceHash) return false;
        if (revenue.value != amount) return false;
        return true;
    }

    function assetStatus(bytes32 assetId) external view returns (AssetStatus) {
        return _assets[assetId].status;
    }

    function assetToken(bytes32 assetId) external view returns (address) {
        return _assets[assetId].token;
    }

    function assetOwner(bytes32 assetId) external view returns (address) {
        return _assets[assetId].owner;
    }

    function assetExists(bytes32 assetId) external view returns (bool) {
        return _assets[assetId].owner != address(0);
    }

    function assetAgreementHash(bytes32 assetId) external view returns (bytes32) {
        return _assets[assetId].agreementHash;
    }

    function getAsset(bytes32 assetId) external view returns (AssetView memory) {
        return _assets[assetId];
    }

    function attestationCount(bytes32 assetId, AttestationType kind)
        external
        view
        returns (uint256)
    {
        return _attestations[assetId][kind].length;
    }

    function getAttestation(bytes32 assetId, AttestationType kind, uint256 index)
        external
        view
        returns (Attestation memory)
    {
        return _attestations[assetId][kind][index];
    }

    function getLatestAttestation(bytes32 assetId, AttestationType kind)
        external
        view
        returns (Attestation memory)
    {
        return _latestAttestation(assetId, kind);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _requireAsset(bytes32 assetId) private view returns (AssetView storage a) {
        a = _assets[assetId];
        if (a.owner == address(0)) revert AssetNotFound();
    }

    function _latestAttestation(bytes32 assetId, AttestationType kind)
        private
        view
        returns (Attestation memory)
    {
        Attestation[] storage list = _attestations[assetId][kind];
        if (list.length == 0) {
            return Attestation({
                verifier: address(0),
                attestationType: kind,
                evidenceHash: bytes32(0),
                value: 0,
                timestamp: 0,
                valid: false
            });
        }
        return list[list.length - 1];
    }

    function _setStatus(bytes32 assetId, AssetStatus to) private {
        AssetView storage a = _assets[assetId];
        AssetStatus from = a.status;
        if (from == to) return;
        a.status = to;
        emit AssetStatusChanged(assetId, from, to);
    }
}
