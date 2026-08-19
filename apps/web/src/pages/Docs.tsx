import { type FC } from 'react';

export const Docs: FC = () => {
  return (
    <div className="docs-page fade-in">
      {/* Header */}
      <div className="docs-header">
        <h1>Scale Protocol Documentation</h1>
        <p className="docs-header-sub">
          Leveraged memecoin trading on Solana. Built on pump.fun coins. Permissionless token listing.
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
        <a href="#profit-locks" className="docs-toc-link">Profit Locks &amp; $SCALE</a>
        <a href="#fee-structure" className="docs-toc-link">Fee Structure</a>
        <a href="#revenue-distribution" className="docs-toc-link">Revenue Distribution</a>
      </nav>

      {/* Overview */}
      <section id="overview" className="docs-section">
        <h2>Overview</h2>
        <p>
          Scale Protocol enables leveraged spot trading on pump.fun memecoins on Solana.
          Traders deposit SOL as collateral, and the protocol supplies the remaining capital from a shared lending pool
          to open a larger position. Trades are executed as real spot buys on-chain via Jupiter — not synthetic perpetuals.
        </p>
        <p>
          Any coin genuinely launched on pump.fun can be listed for leveraged trading — the launch is
          verified on-chain, and the creator's 30% revenue share accrues to the on-chain dev wallet as claimable payouts (Creator dashboard).
          This creates a self-sustaining cycle: trade fees refill the pool, the pool enables leveraged trades,
          and fees generate revenue for creators, the protocol, and $SCALE token holders.
        </p>
        <div className="docs-callout">
          <div className="docs-callout-title">Core Guarantee</div>
          <p>
            The protocol is designed with strict risk management. All positions have strict auto-close thresholds, safety buffers,
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
          Browse listed tokens on the Explore page or the Pulse feed sidebar. Only coins verified as genuine
          pump.fun launches are available for trading. This requirement guarantees every listed coin has a
          verifiable on-chain creator and real liquidity.
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
          <li><strong>30%</strong> is used to buy $SCALE tokens, which are locked for 7 days and then claimable on the Locks page</li>
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
                <td>Graduated on pump.fun, $1M+ market cap, $50K+ liquidity</td>
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
                <td>Any pump.fun coin with $5K+ liquidity</td>
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
          Scale Protocol is architecturally designed to protect its capital under all market conditions.
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
          Token listing on Scale Protocol is fully automatic and requires no account creation, no application form,
          and no manual approval. The process is entirely on-chain and verifiable:
        </p>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div>
              <h4>Launch on pump.fun</h4>
              <p>
                A genuine pump.fun launch is the listing gate — bonding curve or graduated.
                The wallet that launched the coin is the creator's on-chain dev wallet.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div>
              <h4>Paste the Mint Address</h4>
              <p>
                Submit the coin's mint address on the List page. SCALE verifies the pump.fun
                launch on-chain — coins not launched on pump.fun are rejected with the exact reason.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div>
              <h4>Automatic Listing</h4>
              <p>
                Once verified, the coin is listed within minutes with no further action required.
                Creator earnings accrue to the on-chain dev wallet as claimable payouts.
              </p>
            </div>
          </div>
        </div>

        <div className="docs-callout">
          <div className="docs-callout-title">Why pump.fun Launches Only?</div>
          <p>
            By gating listings to genuine pump.fun launches, SCALE guarantees every listed coin has a
            verifiable on-chain creator and standard launch mechanics. The dev wallet is read straight
            from the chain, so the creator revenue share accrues without any setup — no registration, no forms. Claim from the Creator dashboard.
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
          <li><strong>30%</strong> of the flat fee goes to the coin's creator — the pump.fun launch (dev) wallet</li>
          <li>Creator earnings accrue to the launch (dev) wallet — claimable from the Creator dashboard</li>
          <li>No claiming required — payouts land directly in your launch wallet</li>
        </ul>
        <p>
          The Creator Dashboard provides a full breakdown of trading volume, fees generated, and unclaimed
          earnings for each of your listed tokens.
        </p>
      </section>

      {/* Profit Locks */}
      <section id="profit-locks" className="docs-section">
        <h2>Profit Locks &amp; $SCALE</h2>
        <p>
          When a trader closes a profitable position, 30% of the profit is automatically used to purchase
          $SCALE tokens on the open market. These tokens are locked for 7 days in a time-locked contract.
        </p>
        <ul className="docs-list">
          <li>After 7 days, the locked $SCALE tokens become claimable on the Locks page</li>
          <li>Lock status and countdown timers are visible in the Locks dashboard</li>
          <li>This mechanism creates consistent buy pressure on $SCALE and aligns trader incentives with the protocol</li>
        </ul>

        <h3>Buy &amp; Burn</h3>
        <p>
          20% of all flat fee revenue is used to buy $SCALE on the open market and permanently burn the tokens.
          This creates persistent deflationary pressure and is tracked on the Stats page.
        </p>
      </section>

      {/* Fee Structure */}
      <section id="fee-structure" className="docs-section">
        <h2>Fee Structure</h2>
        <p>
          Scale Protocol charges a single flat fee on the total position size when a position is opened.
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
            <p>Used to purchase and permanently burn $SCALE tokens</p>
          </div>
        </div>

        <p>
          Profit from successful trades is split separately:
          70% goes to the trader as SOL, and 30% auto-buys $SCALE (locked 7 days).
        </p>
      </section>
    </div>
  );
};
