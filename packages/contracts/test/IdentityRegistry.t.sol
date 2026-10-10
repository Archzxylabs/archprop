// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

/**
 * @title IdentityRegistryTest
 * @notice Direct coverage for the investor approval gate. The write surface is
 *         `setInvestorApproval` alone, and it is `DEFAULT_ADMIN_ROLE`-only.
 */
contract IdentityRegistryTest is Test {
    IdentityRegistry internal identity;

    address internal admin = makeAddr("admin");
    address internal outsider = makeAddr("outsider");
    address internal investor1 = makeAddr("investor1");
    address internal investor2 = makeAddr("investor2");

    function setUp() public {
        identity = new IdentityRegistry(admin);
    }

    function test_construction_rejectsZeroAdmin() public {
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        new IdentityRegistry(address(0));
    }

    function test_construction_grantsAdminOnly() public {
        assertTrue(identity.hasRole(identity.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(identity.hasRole(identity.DEFAULT_ADMIN_ROLE(), outsider));
    }

    function test_adminCanApproveAndRevoke() public {
        vm.startPrank(admin);
        identity.setInvestorApproval(investor1, true);
        assertTrue(identity.isApproved(investor1));

        identity.setInvestorApproval(investor1, false);
        assertFalse(identity.isApproved(investor1));
        vm.stopPrank();
    }

    function test_setInvestorApproval_rejectsArbitraryWallet() public {
        vm.expectRevert();
        vm.prank(outsider);
        identity.setInvestorApproval(investor1, true);

        assertFalse(identity.isApproved(investor1));
    }

    function test_setInvestorApproval_rejectsZeroInvestor() public {
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        vm.prank(admin);
        identity.setInvestorApproval(address(0), true);
    }

    function test_setInvestorApproval_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(identity));
        emit IdentityRegistry.InvestorApprovalChanged(investor1, true);
        vm.prank(admin);
        identity.setInvestorApproval(investor1, true);

        vm.expectEmit(true, false, false, true, address(identity));
        emit IdentityRegistry.InvestorApprovalChanged(investor1, false);
        vm.prank(admin);
        identity.setInvestorApproval(investor1, false);
    }

    function test_defaultDeniesEveryone() public {
        assertFalse(identity.isApproved(investor1));
        assertFalse(identity.isApproved(investor2));
        assertFalse(identity.isApproved(admin));
        assertFalse(identity.isApproved(address(0)));
    }
}
