import { type FC } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Privacy policy and terms, served at /privacy and /terms.
 *
 * These exist because they are true of the product, not as decoration: LOADED
 * holds custodial keys and signs transactions on a user's behalf, so people are
 * entitled to a plain description of what is stored and what can go wrong.
 * Google also requires both links before an OAuth app can be published.
 */
const UPDATED = '8 September 2026';

const Privacy: FC = () => (
  <>
    <div className="docs-header">
      <h1>Privacy Policy</h1>
      <p className="docs-header-sub">Last updated {UPDATED}</p>
    </div>

    <section className="docs-section">
      <h2>What we collect</h2>
      <p>
        <strong>Your email address.</strong> Supplied either directly when you register
        or by Google when you sign in with Google. We request only your basic
        profile and email; we never receive your Google password, and we cannot
        act on your Google account.
      </p>
      <p>
        <strong>A custodial wallet.</strong> When you create an account we generate a
        Robinhood Chain wallet for you. Its private key is encrypted at rest
        (AES-256-GCM) and is used solely to sign the trades you initiate.
      </p>
      <p>
        <strong>Your trading records.</strong> Positions, sizes, entry and exit prices,
        profit and loss, points and referrals.
      </p>
      <p>
        <strong>Anti-abuse signals.</strong> The IP address and a browser-generated device
        identifier at sign-up, used only to limit duplicate accounts.
      </p>
    </section>

    <section className="docs-section">
      <h2>What we do not do</h2>
      <p>
        We do not sell your data, share it with advertisers, or run advertising or
        cross-site tracking. We do not ask for your name, address, phone number,
        date of birth, or any government identity document.
      </p>
    </section>

    <section className="docs-section">
      <h2>What is public regardless</h2>
      <p>
        Everything that happens on-chain is public and permanent, and that is not
        something we can undo. Your wallet address, every trade it makes, and the
        protocol pool's activity are all visible on the Robinhood Chain explorer
        to anyone, forever. Deleting your account does not remove them.
      </p>
    </section>

    <section className="docs-section">
      <h2>Third parties we send data to</h2>
      <p>
        <strong>Google</strong> — only if you choose to sign in with Google.{' '}
        <strong>Market data providers</strong> — we request public price data for
        tokens; this reveals which token pages are being viewed, never who is
        viewing them. <strong>Infrastructure providers</strong> that host the site,
        API, and database on our behalf. We do not send your email address or
        trading history to any advertising or analytics broker.
      </p>
    </section>

    <section className="docs-section">
      <h2>Retention and deletion</h2>
      <p>
        Account data is kept while your account exists. You can request deletion at
        any time by emailing the address below. Two honest caveats: on-chain
        history cannot be deleted by anyone, and we retain the minimum records
        needed to settle any position that is still open.
      </p>
    </section>

    <section className="docs-section">
      <h2>Security, stated plainly</h2>
      <p>
        Custodial keys are encrypted at rest and never leave our servers. That said,
        custody means you are trusting us with those keys. No system is immune to
        compromise. Do not keep more in a custodial wallet than you are prepared to
        lose, and withdraw profits you are not actively trading.
      </p>
    </section>

    <section className="docs-section">
      <h2>Contact</h2>
      <p>
        Questions or a deletion request: <strong>realdoomsalt@gmail.com</strong>
      </p>
    </section>
  </>
);

const Terms: FC = () => (
  <>
    <div className="docs-header">
      <h1>Terms of Service</h1>
      <p className="docs-header-sub">Last updated {UPDATED}</p>
    </div>

    <section className="docs-section">
      <h2>What LOADED is</h2>
      <p>
        LOADED is a leveraged spot trading terminal for launchpad memecoins on
        Robinhood Chain. You post collateral, the protocol pool fronts the rest,
        and the combined size buys the token on-chain. It is not a broker, a bank,
        an exchange, or an investment adviser, and nothing on this site is
        financial advice.
      </p>
    </section>

    <section className="docs-section">
      <h2>Risk — read this part</h2>
      <p>
        <strong>You can lose everything you put in.</strong> Memecoins are extremely
        volatile and frequently go to zero. Leverage multiplies losses exactly as
        it multiplies gains.
      </p>
      <p>
        <strong>Positions are liquidated automatically.</strong> Each tier has a
        liquidation threshold, shown before you open. When price crosses it your
        position is closed and your collateral is consumed. At higher leverage a
        small move against you is enough.
      </p>
      <p>
        <strong>Your maximum loss is your collateral.</strong> The pool recovers its
        capital before you receive anything, and you are never left owing a debt
        beyond what you posted.
      </p>
      <p>
        <strong>Positions close within 24 hours.</strong> Every position auto-closes at
        the 24-hour mark regardless of price.
      </p>
      <p>
        <strong>Execution is real and imperfect.</strong> Trades are on-chain swaps
        subject to slippage, price impact, failed transactions, and network
        conditions. Thin liquidity can move the price against you.
      </p>
    </section>

    <section className="docs-section">
      <h2>Your responsibilities</h2>
      <p>
        You must be legally permitted to use a service like this where you live, and
        old enough to enter a contract there. You are responsible for your account
        credentials, for the tax treatment of your trading, and for the addresses
        you withdraw to — a withdrawal sent to a wrong address cannot be reversed
        by us or by anyone.
      </p>
    </section>

    <section className="docs-section">
      <h2>Listings are not endorsements</h2>
      <p>
        A coin appears here because its creator routed their launchpad creator fees
        to the protocol pool and it cleared a liquidity floor. That is an economic
        arrangement, not diligence. We do not vet teams and we do not vouch for any
        token. Assume every listed coin can go to zero.
      </p>
    </section>

    <section className="docs-section">
      <h2>Availability</h2>
      <p>
        The service is provided as-is, without warranty. We may change fees, tiers,
        leverage limits, or suspend trading — including for a specific token whose
        market has broken down. We rely on third-party infrastructure and cannot
        guarantee uninterrupted access, and you should not assume you will always
        be able to close a position at a moment of your choosing.
      </p>
    </section>

    <section className="docs-section">
      <h2>Liability</h2>
      <p>
        To the maximum extent the law allows, LOADED is not liable for trading
        losses, liquidations, missed opportunities, chain or provider outages, or
        losses arising from third-party services. Your remedy is to stop using the
        service and withdraw your funds.
      </p>
    </section>

    <section className="docs-section">
      <h2>Contact</h2>
      <p><strong>realdoomsalt@gmail.com</strong></p>
    </section>
  </>
);

export const Legal: FC = () => {
  const { pathname } = useLocation();
  return (
    <div className="docs-page fade-in">
      {pathname.startsWith('/terms') ? <Terms /> : <Privacy />}
    </div>
  );
};
