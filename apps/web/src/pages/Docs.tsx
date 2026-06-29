import { type FC } from 'react';

export const Docs: FC = () => {
  return (
    <div className="docs-page fade-in">
      {/* Header */}
      <div className="docs-header">
        <h1>Front Protocol Documentation</h1>
        <p className="docs-header-sub">
          Leveraged memecoin trading on Solana. Backed by Pump.fun creator rewards. Permissionless token listing.
        </p>
      </div>

      {/* Table of Contents */}
      <nav className="docs-toc card">
        <div className="docs-toc-title">Contents</div>
        <a href="#overview" className="docs-toc-link">Overview</a>
        <a href="#how-trading-works" className="docs-toc-link">How Trading Works</a>
        <a href="#risk-tiers" className="docs-toc-link">Risk Tiers</a>
        <a href="#protocol-safety" className="docs-toc-link">Protocol Safety Model</a>
        <a href="#token-listing" className="docs-toc-link">Token Listing</a>
        <a href="#creator-revenue" className="docs-toc-link">Creator Revenue</a>
        <a href="#profit-locks" className="docs-toc-link">Profit Locks &amp; $FRONT</a>
        <a href="#fee-structure" className="docs-toc-link">Fee Structure</a>
        <a href="#revenue-distribution" className="docs-toc-link">Revenue Distribution</a>
      </nav>

      {/* Overview */}
      <section id="overview" className="docs-section">
        <h2>Overview</h2>
        <p>
          Front Protocol enables leveraged spot trading on Pump.fun and Raydium-listed memecoins on Solana.
          Traders deposit SOL as collateral, and the protocol supplies the remaining capital from a shared lending pool
          to open a larger position. Trades are executed as real spot buys on-chain via Jupiter aggregator — not synthetic perpetuals.
        </p>
        <p>
          The lending pool is funded by Pump.fun creator rewards. Token creators who redirect 100% of their creator
          reward allocation to the protocol wallet get their token automatically listed for leveraged trading.
          This creates a self-sustaining cycle: creator rewards fund the pool, the pool enables leveraged trades,
          trade fees generate revenue for creators, the protocol, and $FRONT token holders.
        </p>
        <div className="docs-callout">
          <div className="docs-callout-title">Core Guarantee</div>
          <p>
            The protocol is designed to never lose money. All positions have strict auto-close thresholds, safety buffers,
            position size caps relative to liquidity, and a maximum 24-hour duration. The protocol always recovers
            its capital plus fees before any loss scenario can materialize.
          </p>
        </div>
      </section>

      {/* How Trading Works */}
      <section id="how-trading-works" className="docs-section">
        <h2>How Trading Works</h2>

        <h3>1. Select a Token</h3>
        <p>
          Browse listed tokens on the Explore page or the Pulse feed sidebar. Only tokens whose creators have redirected
          their Pump.fun creator rewards to the protocol wallet are available for trading. This requirement ensures
          continuous capital inflow to the lending pool.
        </p>

        <h3>2. Configure Your Position</h3>
        <p>
          Set your collateral amount (SOL you put at risk) and leverage multiplier. The available leverage depends on
          the token's risk tier — bonded tokens allow up to 7x, rising tokens up to 5x, and degen-tier tokens up to 3x.
        </p>
        <div className="docs-example">
          <div className="docs-example-title">Example</div>
          <p>
            You deposit <span className="mono">0.5 SOL</span> at <span className="mono">5x</span> leverage.
            The protocol supplies <span className="mono">2.0 SOL</span> from the lending pool.
            A real spot buy of <span className="mono">2.5 SOL</span> worth of tokens is executed on-chain via Jupiter.
            You pay a flat fee of <span className="mono">0.5%</span> (0.0125 SOL) on the total position size.
          </p>
        </div>

        <h3>3. Profit Scenario</h3>
        <p>
          If the token price increases, you can close the position manually at any time or let it auto-close after 24 hours.
          The tokens are sold back to SOL via Jupiter. The protocol recovers its capital (2.0 SOL) first. Of the remaining profit:
        </p>
        <ul className="docs-list">
          <li><strong>70%</strong> is returned to you as SOL immediately</li>
          <li><strong>30%</strong> is used to buy $FRONT tokens, which are locked for 7 days and then claimable on the Locks page</li>
        </ul>

        <h3>4. Loss Scenario</h3>
        <p>
          If the token price drops, the protocol's price monitor triggers an automatic close when your collateral
          absorption reaches the exit threshold. The threshold varies by tier:
        </p>
        <ul className="docs-list">
          <li>Bonded: auto-close at <span className="mono text-red">-15%</span> portfolio loss</li>
          <li>Rising: auto-close at <span className="mono text-red">-12%</span> portfolio loss</li>
          <li>Degen: auto-close at <span className="mono text-red">-10%</span> portfolio loss</li>
        </ul>
        <p>
          The 5% safety buffer ensures that even with slippage during the sell, the protocol always recovers 100% of its capital.
          You lose your collateral (or a portion of it), but the protocol's lending pool remains whole.
        </p>
      </section>

      {/* Risk Tiers */}
      <section id="risk-tiers" className="docs-section">
        <h2>Risk Tiers</h2>
        <p>
          Every listed token is classified into one of three risk tiers based on its on-chain fundamentals.
          The tier determines the maximum available leverage, fee rate, and auto-close threshold.
        </p>
        <div className="docs-table-wrap">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Max Leverage</th>
                <th>Flat Fee</th>
                <th>Exit Threshold</th>
                <th>Requirements</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge badge-bonded">Bonded</span></td>
                <td className="mono">7x</td>
                <td className="mono">2%</td>
                <td className="mono">-15%</td>
                <td>Graduated to Raydium, $1M+ market cap, $50K+ liquidity</td>
              </tr>
              <tr>
                <td><span className="badge badge-rising">Rising</span></td>
                <td className="mono">5x</td>
                <td className="mono">3%</td>
                <td className="mono">-12%</td>
                <td>$100K+ market cap, $10K+ liquidity</td>
              </tr>
              <tr>
                <td><span className="badge badge-degen">Degen</span></td>
                <td className="mono">3x</td>
                <td className="mono">5%</td>
                <td className="mono">-10%</td>
                <td>Any Pump.fun token with $5K+ liquidity</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Tiers are re-evaluated periodically. A token may be promoted from Degen to Rising, or from Rising to Bonded,
          as its liquidity and market cap grow. Tier downgrades also occur if fundamentals deteriorate.
        </p>
      </section>

      {/* Protocol Safety */}
      <section id="protocol-safety" className="docs-section">
        <h2>Protocol Safety Model</h2>
        <p>
          Front Protocol is architecturally designed to protect its capital under all market conditions.
          The following mechanisms work together to ensure the lending pool is never depleted:
        </p>

        <h3>Auto-Close Thresholds</h3>
        <p>
          The price monitor service polls live prices every 5 seconds via the Jupiter Price API.
          When a position's unrealized loss reaches the tier-specific threshold, the system
          automatically sells the tokens and recovers the protocol's capital. A 5% safety buffer
          above the mathematical break-even point ensures full recovery even with swap slippage.
        </p>

        <h3>Position Size Caps</h3>
        <p>
          No single position can exceed a percentage of the token's total on-chain liquidity.
          This prevents positions from moving the market on exit:
        </p>
        <ul className="docs-list">
          <li>Bonded: max 5% of liquidity per position</li>
          <li>Rising: max 3% of liquidity per position</li>
          <li>Degen: max 2% of liquidity per position</li>
        </ul>

        <h3>24-Hour Maximum Duration</h3>
        <p>
          All positions auto-close after 24 hours regardless of profit or loss.
          This eliminates indefinite exposure and ensures capital turnover in the lending pool.
        </p>

        <h3>Insurance Fund</h3>
        <p>
          10% of all flat fee revenue is allocated to an insurance fund until it reaches 2% of the total pool size.
          This fund covers edge cases where extreme slippage during auto-close causes a shortfall.
        </p>
      </section>

      {/* Token Listing */}
      <section id="token-listing" className="docs-section">
        <h2>Token Listing</h2>
        <p>
          Token listing on Front Protocol is fully automatic and requires no account creation, no application form,
          and no manual approval. The process is entirely on-chain and verifiable:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div>
              <h4>Configure Creator Rewards</h4>
              <p>
                In your Pump.fun token settings, set the fee-sharing allocation to direct 100% of creator
                rewards to the Front Protocol wallet address.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div>
              <h4>Revoke Admin Access</h4>
              <p>
                Revoke the admin key on your fee-sharing configuration to make it immutable.
                This proves to traders that the reward flow cannot be changed — trustless verification.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div>
              <h4>Automatic Detection</h4>
              <p>
                The protocol's on-chain scanner detects the reward redirect and admin revocation.
                Your token is automatically listed within minutes with no further action required.
              </p>
            </div>
          </div>
        </div>

        <div className="docs-callout">
          <div className="docs-callout-title">Why Creator Rewards?</div>
          <p>
            By requiring creator rewards to flow into the protocol, Front creates a sustainable capital pool
            without relying on external LPs or token emissions. Every listed token actively contributes to the
            pool that enables leveraged trading on all listed tokens. This is the core economic engine of the protocol.
          </p>
        </div>
      </section>

      {/* Creator Revenue */}
      <section id="creator-revenue" className="docs-section">
        <h2>Creator Revenue</h2>
        <p>
          Token creators earn a share of the flat trading fees generated on their token.
          Every time a trader opens a leveraged position on your token, the flat fee is collected and distributed:
        </p>
        <ul className="docs-list">
          <li><strong>30%</strong> of the flat fee goes to the token creator</li>
          <li>Creator earnings are tracked on-chain and can be claimed at any time from the Creator Dashboard</li>
          <li>There is no minimum claim threshold — claim whenever you want</li>
        </ul>
        <p>
          The Creator Dashboard provides a full breakdown of trading volume, fees generated, and unclaimed
          earnings for each of your listed tokens.
        </p>
      </section>

      {/* Profit Locks */}
      <section id="profit-locks" className="docs-section">
        <h2>Profit Locks &amp; $FRONT</h2>
        <p>
          When a trader closes a profitable position, 30% of the profit is automatically used to purchase
          $FRONT tokens on the open market. These tokens are locked for 7 days in a time-locked contract.
        </p>
        <ul className="docs-list">
          <li>After 7 days, the locked $FRONT tokens become claimable on the Locks page</li>
          <li>Lock status and countdown timers are visible in the Locks dashboard</li>
          <li>This mechanism creates consistent buy pressure on $FRONT and aligns trader incentives with the protocol</li>
        </ul>

        <h3>Buy &amp; Burn</h3>
        <p>
          20% of all flat fee revenue is used to buy $FRONT on the open market and permanently burn the tokens.
          This creates persistent deflationary pressure and is tracked on the Stats page.
        </p>
      </section>

      {/* Fee Structure */}
      <section id="fee-structure" className="docs-section">
        <h2>Fee Structure</h2>
        <p>
          Front Protocol charges a single flat fee on the total position size when a position is opened.
          There are no funding rates, no borrowing fees, and no hidden charges.
        </p>
        <div className="docs-table-wrap">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Flat Fee</th>
                <th>Applied To</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge badge-bonded">Bonded</span></td>
                <td className="mono">2%</td>
                <td>Total position size (collateral + protocol capital)</td>
              </tr>
              <tr>
                <td><span className="badge badge-rising">Rising</span></td>
                <td className="mono">3%</td>
                <td>Total position size</td>
              </tr>
              <tr>
                <td><span className="badge badge-degen">Degen</span></td>
                <td className="mono">5%</td>
                <td>Total position size</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Revenue Distribution */}
      <section id="revenue-distribution" className="docs-section">
        <h2>Revenue Distribution</h2>
        <p>All flat fee revenue collected by the protocol is distributed as follows:</p>

        <div className="docs-revenue-grid">
          <div className="docs-revenue-card">
            <div className="docs-revenue-pct">50%</div>
            <div className="docs-revenue-label">Capital Pool</div>
            <p>Returned to the lending pool to fund future leveraged positions</p>
          </div>
          <div className="docs-revenue-card">
            <div className="docs-revenue-pct" style={{ color: 'var(--cyan)' }}>30%</div>
            <div className="docs-revenue-label">Token Creators</div>
            <p>Distributed to the creator of the token that was traded</p>
          </div>
          <div className="docs-revenue-card">
            <div className="docs-revenue-pct" style={{ color: 'var(--yellow)' }}>20%</div>
            <div className="docs-revenue-label">Buy &amp; Burn</div>
            <p>Used to purchase and permanently burn $FRONT tokens</p>
          </div>
        </div>

        <p>
          Profit from successful trades is split separately:
          70% goes to the trader as SOL, and 30% auto-buys $FRONT (locked 7 days).
        </p>
      </section>
    </div>
  );
};
