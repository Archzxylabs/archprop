// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeToken
 * @notice Test-only ERC20 token that deducts or burns a fee on transfer.
 *         Used to test fee-on-transfer / deflationary payment token rejection in OfferingEscrow.
 */
contract MockFeeToken is ERC20 {
    uint256 public feeBps;
    address public feeCollector;
    bool public burnFee;

    constructor(
        string memory name,
        string memory symbol,
        uint256 feeBps_,
        address feeCollector_,
        bool burnFee_
    ) ERC20(name, symbol) {
        feeBps = feeBps_;
        feeCollector = feeCollector_;
        burnFee = burnFee_;
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            if (fee == 0 && value > 0) fee = 1;
            uint256 netValue = value - fee;

            if (burnFee) {
                super._update(from, address(0), fee);
            } else if (feeCollector != address(0)) {
                super._update(from, feeCollector, fee);
            }
            super._update(from, to, netValue);
        } else {
            super._update(from, to, value);
        }
    }
}
