// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockIdentity {
    mapping(address => bool) private _whitelisted;

    function whitelist(address user) external {
        _whitelisted[user] = true;
    }

    function blacklist(address user) external {
        _whitelisted[user] = false;
    }

    function isWhitelisted(address user) external view returns (bool) {
        return _whitelisted[user];
    }
}
