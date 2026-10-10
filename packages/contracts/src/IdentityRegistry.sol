// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./ArchpropInterfaces.sol";

/**
 * @title IdentityRegistry
 * @notice Demo-only investor approval list. No KYC material is stored on-chain.
 *
 * @dev Approval is an admin-only act: there is no separate approver role, so a
 *      compromised sub-granted key cannot admit investors on its own.
 */
contract IdentityRegistry is AccessControl, IIdentityRegistry {
    mapping(address => bool) private _approved;

    event InvestorApprovalChanged(address indexed investor, bool approved);

    error ZeroAddress();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Grants or revokes investor approval. Requires `DEFAULT_ADMIN_ROLE`.
    function setInvestorApproval(address investor, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (investor == address(0)) revert ZeroAddress();
        _approved[investor] = approved;
        emit InvestorApprovalChanged(investor, approved);
    }

    function isApproved(address investor) external view returns (bool) {
        return _approved[investor];
    }
}
