import { Link } from 'react-router-dom';
import logoUrl from '../assets/logo-120.png';

export function BrandLockup() {
  return (
    <div className="brand-lockup">
      <img className="brand-logo" src={logoUrl} alt="When2Blind logo" />
      <div>
        <p className="eyebrow">When2Blind</p>
      </div>
    </div>
  );
}

export function PageActions() {
  return (
    <div className="page-actions">
      <Link className="brand-link" to="/">
        <img className="brand-logo brand-logo-small" src={logoUrl} alt="When2Blind logo" />
        <span className="eyebrow">When2Blind</span>
      </Link>
      <Link className="button-link secondary-link" to="/">
        Back to start page
      </Link>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="inline-link" to="/privacy/">
        Privacy policy
      </Link>
      <Link className="inline-link" to="/terms/">
        Terms of service
      </Link>
      <a className="inline-link" href="https://kollnig.net/impress/" target="_blank" rel="noreferrer">
        Site notice
      </a>
    </footer>
  );
}
