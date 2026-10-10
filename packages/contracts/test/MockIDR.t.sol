// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockIDR} from "../src/MockIDR.sol";

/**
 * @title MockIDRTest
 * @notice Direct coverage for the demo currency. The faucet is the only write
 *         surface, there is no privileged mint, and decimals are zero.
 */
contract MockIDRTest is Test {
    MockIDR internal midr;

    address internal admin = makeAddr("admin");
    address internal user = makeAddr("user");
    address internal faucetUser = makeAddr("faucetUser");

    uint256 internal constant MAX_FAUCET_AMOUNT = 10_000_000_000;

    function setUp() public {
        midr = new MockIDR(admin);
    }

    function test_construction_rejectsZeroAdmin() public {
        vm.expectRevert(MockIDR.ZeroAddress.selector);
        new MockIDR(address(0));
    }

    function test_decimals_areZero() public {
        assertEq(midr.decimals(), 0);
    }

    function test_nameAndSymbol() public {
        assertEq(midr.name(), "Mock IDR");
        assertEq(midr.symbol(), "mIDR");
    }

    function test_faucet_rejectsZero() public {
        vm.expectRevert(abi.encodeWithSelector(MockIDR.FaucetAmountOutOfRange.selector, 0));
        vm.prank(user);
        midr.faucet(0);
    }

    function test_faucet_rejectsAmountAboveMaximum() public {
        vm.expectRevert(
            abi.encodeWithSelector(MockIDR.FaucetAmountOutOfRange.selector, MAX_FAUCET_AMOUNT + 1)
        );
        vm.prank(user);
        midr.faucet(MAX_FAUCET_AMOUNT + 1);
    }

    function test_faucet_acceptsExactlyTheMaximum() public {
        vm.prank(user);
        midr.faucet(MAX_FAUCET_AMOUNT);
        assertEq(midr.balanceOf(user), MAX_FAUCET_AMOUNT);
        assertEq(midr.totalSupply(), MAX_FAUCET_AMOUNT);
    }

    function test_faucet_mintsTheExactAmount() public {
        uint256 amount = 12_345;
        vm.prank(user);
        midr.faucet(amount);
        assertEq(midr.balanceOf(user), amount);
    }

    function test_faucet_isPermissionless() public {
        // Neither the admin nor any role holder is needed: the faucet is open.
        vm.prank(faucetUser);
        midr.faucet(1_000);
        assertEq(midr.balanceOf(faucetUser), 1_000);
    }

    function test_faucet_emitsDemoMint() public {
        vm.expectEmit(true, false, false, true, address(midr));
        emit MockIDR.DemoMint(user, 777);
        vm.prank(user);
        midr.faucet(777);
    }

    function test_balanceAndSupplyStayConsistentAcrossCalls() public {
        address second = makeAddr("second");

        vm.prank(user);
        midr.faucet(1_000);
        vm.prank(second);
        midr.faucet(2_500);

        assertEq(midr.balanceOf(user), 1_000);
        assertEq(midr.balanceOf(second), 2_500);
        assertEq(midr.totalSupply(), 3_500);
        assertEq(midr.totalSupply(), midr.balanceOf(user) + midr.balanceOf(second));
    }
}
