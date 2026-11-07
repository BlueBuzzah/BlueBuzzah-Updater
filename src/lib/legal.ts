// The owner's legally chosen wording. Use verbatim; never reword or shorten.
export const MEDICAL_DISCLAIMER =
  'BlueBuzzah devices are not FDA approved medical devices and not intended to diagnose, treat, cure, or prevent any disease. The information provided through BlueBuzzah is for general wellness purposes only and not a substitute for professional medical advice, diagnosis, or treatment.';

export const IMPLANT_NOTICE =
  'Important: People with implanted electrodes from deep brain stimulation (DBS), heart pacemakers, or other internal electronic devices should take special precautions around all electronic devices, including BlueBuzzah. Consult your physician before use.';

/** Effective date shown on the Terms page. Bump it there and here; the app asks again when they differ. */
export const TERMS_EFFECTIVE_DATE = '2026-11-07';
export const TERMS_URL = 'https://bluebuzzah.com/terms.html';
export const PRIVACY_URL = 'https://bluebuzzah.com/privacy.html';

/** True until the person has agreed to the current Terms. */
export function needsTermsAcceptance(accepted: string | null | undefined): boolean {
  return accepted !== TERMS_EFFECTIVE_DATE;
}
