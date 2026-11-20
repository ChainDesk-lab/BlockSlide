// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// A token whose behaviour towards one address can be switched, to test how
/// the shop handles a UBI recipient that rejects or silently fails a transfer.
contract MockMisbehavingERC20 {
    enum Mode { Normal, ReturnFalse, Revert }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public target;
    Mode public mode;

    function setMisbehaviour(address _target, Mode _mode) external {
        target = _target;
        mode = _mode;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _misbehaves(address to) internal view returns (bool returnFalse) {
        if (to != target || mode == Mode.Normal) return false;
        if (mode == Mode.Revert) revert("recipient rejected");
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (_misbehaves(to)) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_misbehaves(to)) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

interface IShop {
    function buyStreakShield() external;
}

/// A token that calls back into the shop from inside transferFrom, as an
/// ERC-777-style hook could (G$ on Celo is a Superfluid SuperToken).
contract MockReentrantERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IShop public shop;
    bool public armed;

    function arm(IShop _shop) external {
        shop = _shop;
        armed = true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (armed) {
            armed = false;
            shop.buyStreakShield(); // re-enter the shop mid-payment
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
