// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title ArchpropInterfaces
 * @notice Frozen ABI contract from `docs/INTERFACES.md`. The enums and structs
 *         below are declared at file level so both the interfaces and the
 *         implementations share one definition.
 */
enum AssetStatus {
    SUBMITTED,
    UNDER_VERIFICATION,
    VERIFIED,
    ISSUANCE_READY,
    OFFERING,
    FUNDED,
    ACTIVE,
    REJECTED,
    FAILED
}

enum AttestationType {
    OWNERSHIP,
    VALUATION,
    REVENUE
}

enum OfferingStatus {
    OPEN,
    FUNDED,
    FAILED
}

struct Attestation {
    address verifier;
    AttestationType attestationType;
    bytes32 evidenceHash;
    uint256 value;
    uint64 timestamp;
    bool valid;
}

struct AssetView {
    address owner;
    bytes32 metadataHash;
    bytes32 agreementHash;
    AssetStatus status;
    address token;
}

struct OfferingView {
    bytes32 assetId;
    address propertyToken;
    address paymentToken;
    uint256 target;
    uint256 tokenPrice;
    uint64 deadline;
    uint256 raised;
    address issuerTreasury;
    OfferingStatus status;
    bool fundsReleased;
}

struct RevenueEpochView {
    bytes32 assetId;
    address propertyToken;
    address paymentToken;
    uint256 amount;
    uint256 totalSupply;
    uint64 claimDeadline;
    address funder;
    uint256 claimedAmount;
    bool closed;
}

interface IArchpropRegistry {
    function createAsset(bytes32 assetId, bytes32 metadataHash) external;
    function beginVerification(bytes32 assetId) external;
    function submitAttestation(
        bytes32 assetId,
        AttestationType kind,
        bytes32 evidenceHash,
        uint256 value
    ) external;
    function rejectAsset(bytes32 assetId, AttestationType kind, bytes32 evidenceHash) external;
    function finalizeVerification(bytes32 assetId) external;
    function registerAgreement(bytes32 assetId, bytes32 agreementHash) external;
    function markIssuanceReady(bytes32 assetId) external;
    function linkToken(bytes32 assetId, address token) external;
    function setEscrow(address escrow) external;
    function transitionFromEscrow(bytes32 assetId, AssetStatus status) external;
    function isRevenueAttestationValid(bytes32 assetId, bytes32 evidenceHash, uint256 amount)
        external
        view
        returns (bool);
    function assetStatus(bytes32 assetId) external view returns (AssetStatus);
    function assetToken(bytes32 assetId) external view returns (address);
    function assetOwner(bytes32 assetId) external view returns (address);
    function getAsset(bytes32 assetId) external view returns (AssetView memory);
    function getLatestAttestation(bytes32 assetId, AttestationType kind)
        external
        view
        returns (Attestation memory);
}

interface IIdentityRegistry {
    function isApproved(address investor) external view returns (bool);
    function setInvestorApproval(address investor, bool approved) external;
}

interface IPropertyToken {
    function assetId() external view returns (bytes32);
    function identityRegistry() external view returns (address);
    function offeringEscrow() external view returns (address);
    function revenueDistributor() external view returns (address);
    function setRevenueTransferLock(bool locked) external;
}

interface IMockIDR {
    function faucet(uint256 amount) external;
}

interface IOfferingEscrow {
    function createOffering(
        bytes32 assetId,
        address propertyToken,
        address paymentToken,
        uint256 target,
        uint256 tokenPrice,
        uint64 deadline,
        address issuerTreasury
    ) external returns (uint256 offeringId);
    function invest(uint256 offeringId, uint256 paymentAmount) external;
    function finalizeSuccessfulOffering(uint256 offeringId) external;
    function failOffering(uint256 offeringId) external;
    function claimTokens(uint256 offeringId) external;
    function claimRefund(uint256 offeringId) external;
    function releaseFunds(uint256 offeringId) external;
    function getOffering(uint256 offeringId) external view returns (OfferingView memory);
    function allocationOf(uint256 offeringId, address investor) external view returns (uint256);
    function paymentOf(uint256 offeringId, address investor) external view returns (uint256);
    function tokensClaimed(uint256 offeringId, address investor) external view returns (bool);
    function refundClaimed(uint256 offeringId, address investor) external view returns (bool);
}

interface IRevenueDistributor {
    function publishRevenue(
        bytes32 assetId,
        address propertyToken,
        address paymentToken,
        uint256 amount,
        bytes32 evidenceHash,
        uint64 claimDeadline
    ) external returns (uint256 epochId);
    function claimRevenue(uint256 epochId) external;
    function closeRevenueEpoch(uint256 epochId) external;
    function getRevenueEpoch(uint256 epochId) external view returns (RevenueEpochView memory);
    function claimableRevenue(uint256 epochId, address investor) external view returns (uint256);
    function revenueClaimed(uint256 epochId, address investor) external view returns (bool);
}
