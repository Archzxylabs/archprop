// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IMockIDR} from "./ArchpropInterfaces.sol";

/**
 * @title MockIDR
 * @notice Valueless demo currency for the hackathon demo. It is explicitly not
 *         redeemable for real IDR and carries no monetary value.
 *
 * @dev Whole-unit economics: this token has zero decimals, matching the frozen
 *      protocol rule that mIDR and property token amounts are exact on-chain
 *      integer units.
 *
 *      The only write surface is the bounded faucet. There is no privileged
 *      mint path, so an administrator can no more inflate the supply than an
 *      investor can; the faucet alone bounds every call to
 *      `0 < amount <= MAX_FAUCET_AMOUNT`. The constructor takes an `admin`
 *      address only to keep the frozen deployment signature, and grants it no
 *      privilege whatsoever.
 */
contract MockIDR is ERC20, IMockIDR {
    /// @notice Upper bound of a single faucet call, in whole mIDR units.
    uint256 public constant MAX_FAUCET_AMOUNT = 10_000_000_000;

    event DemoMint(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error FaucetAmountOutOfRange(uint256 amount);

    constructor(address admin) ERC20("Mock IDR", "mIDR") {
        if (admin == address(0)) revert ZeroAddress();
    }

    /// @dev Whole-unit demo currency: no decimal places.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /**
     * @notice Mints demo currency to the caller.
     * @dev Bounded to `0 < amount <= MAX_FAUCET_AMOUNT` per call so the faucet
     *      cannot be used to mint an unbounded supply in one transaction.
     */
    function faucet(uint256 amount) external {
        if (amount == 0 || amount > MAX_FAUCET_AMOUNT) revert FaucetAmountOutOfRange(amount);
        _mint(msg.sender, amount);
        emit DemoMint(msg.sender, amount);
    }
}
