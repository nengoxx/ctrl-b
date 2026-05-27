---
name: trading-safety-review
description: Review Telegram signal bot changes for trading-safety invariants before modifying or merging parsing, execution, backtesting, optimizer, routing, or position-management code.
license: MIT
---

# Trading Safety Review

Use this skill before changes that touch parsing, signal lifecycle, execution,
backtesting, optimization, routing, channel policy, status updates, partial
closes, BE handling, or MT5 position management.

## Review Steps

1. Identify the execution boundary.
   - Live trading must go through the serialized MT5 executor path.
   - Backtests, optimizers, parser audits, reports, and dashboard previews must not send MT5 orders.

2. Check signal eligibility.
   - Preview, staged, collecting, rejected, failed, or incomplete signals must never execute.
   - Strategy fallback SL/TP must not complete a staged preview.
   - Missing SL/TP fallbacks may apply only when channel/profile policy allows them.

3. Check routing gates.
   - Parse-only channels must never execute.
   - Disabled channels, disabled accounts, and global auto-off must block execution.
   - Channel-specific overrides must take precedence over global defaults.

4. Check update handling.
   - Status, partial-close, close-now, BE, and provider comment messages must link to existing signals.
   - These updates must not create new trades unless there is an explicit position-management path for an existing position.

5. Check statistics.
   - Backtest and optimizer metrics must aggregate by Telegram `signal_id`.
   - Scaled entries, target splits, fragments, and child orders are implementation details, not separate statistical signals.

6. Verify.
   - Add or update targeted tests for changed behavior.
   - Run `.\.venv\Scripts\python.exe -m pytest tests -q`.
   - List any residual risk in the final response.

