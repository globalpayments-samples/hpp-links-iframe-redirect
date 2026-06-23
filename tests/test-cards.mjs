/**
 * Official Global Payments test-card catalog — single source of truth.
 *
 * Mirrors https://developer.globalpayments.com/gh-assets/markdown%3Aresources%3Atest-cards.md
 * (fetched 2026-06-23). Each entry records the card as published AND how it can be
 * *verified* against this Hosted Payment Page (HPP) sample, which only ever does two
 * card-dependent things: render the GP-hosted card page, then read back the
 * transaction status and classify it success / declined / pending.
 *
 * `expect` — what the verification harness asserts for this card:
 *   'declined'           Sandbox returns DECLINED deterministically. HARD assertion:
 *                        outcome MUST be 'declined'. (Decline codes, SCA-required,
 *                        and the 3-D Secure failure/rejected cards — all confirmed
 *                        deterministic by live probing.)
 *   'terminal'           An "approval" card. The shared GP sandbox account authorises
 *                        3-D Secure card sales NON-DETERMINISTICALLY — the *same* card
 *                        returns PREAUTHORIZED on one run and DECLINED on the next
 *                        (confirmed live; see docs/TEST_CARDS.md). The authorisation
 *                        outcome is an upstream GP property the sample cannot control,
 *                        so we assert the property the sample IS responsible for: the
 *                        flow reaches a terminal, correctly-classified state backed by
 *                        a real TRN_ transaction id and a recognised GP status.
 *   'unsupported'        The hosted page rejects the brand on this account
 *                        ("Cannot process this card type") — JCB / UATP. We assert the
 *                        rejection surfaces gracefully (no crash, no false success).
 *   null (catalogued)    Not exercisable through plain hosted-card entry in this sample
 *                        (needs wallet / DCC / network-token / Click-to-Pay /
 *                        installment / open-banking provisioning or flow). Listed for
 *                        completeness; `note` says why. The harness skips driving these.
 *
 * `cvv` defaults to a 3-digit code; Amex/UATP use 4 digits.
 */

const CVV3 = '123';
const CVV4 = '1234';

/** @typedef {{number:string,brand:string,category:string,documented:string,
 *   expect:('declined'|'terminal'|'unsupported'|null),cvv:string,repr?:boolean,note?:string}} TestCard */

/** @type {TestCard[]} */
export const CATALOG = [
  // ── Standard successful cards (code 00) ──────────────────────────────────
  { number: '4263970000005262', brand: 'Visa',       category: 'standard-success', documented: 'Approved (00)', expect: 'terminal',    cvv: CVV3, repr: true },
  { number: '5425230000004415', brand: 'Mastercard', category: 'standard-success', documented: 'Approved (00)', expect: 'terminal',    cvv: CVV3, repr: true },
  { number: '374101000000608',  brand: 'Amex',       category: 'standard-success', documented: 'Approved (00)', expect: 'terminal',    cvv: CVV4, repr: true },
  { number: '36256000000725',   brand: 'Diners',     category: 'standard-success', documented: 'Approved (00)', expect: 'terminal',    cvv: CVV3 },
  { number: '6011000000000087', brand: 'Discover',   category: 'standard-success', documented: 'Approved (00)', expect: 'terminal',    cvv: CVV3 },
  { number: '3566000000000000', brand: 'JCB',        category: 'standard-success', documented: 'Approved (00)', expect: 'unsupported', cvv: CVV3, repr: true, note: 'Hosted page: "Cannot process this card type" on the transaction_processing_hpp account.' },
  { number: '135400000007187',  brand: 'UATP',       category: 'standard-success', documented: 'Approved (00)', expect: 'unsupported', cvv: CVV4, note: 'Hosted page: "Cannot process this card type" on this account.' },

  // ── Declined — code 101 (Declined by Bank) ───────────────────────────────
  { number: '4000120000001154', brand: 'Visa',       category: 'decline-101', documented: 'Declined (101)', expect: 'declined',    cvv: CVV3, repr: true },
  { number: '5114610000004778', brand: 'Mastercard', category: 'decline-101', documented: 'Declined (101)', expect: 'declined',    cvv: CVV3 },
  { number: '376525000000010',  brand: 'Amex',       category: 'decline-101', documented: 'Declined (101)', expect: 'declined',    cvv: CVV4 },
  { number: '36256000000998',   brand: 'Diners',     category: 'decline-101', documented: 'Declined (101)', expect: 'declined',    cvv: CVV3 },
  { number: '6011000000001010', brand: 'Discover',   category: 'decline-101', documented: 'Declined (101)', expect: 'declined',    cvv: CVV3 },
  { number: '3566000000001016', brand: 'JCB',        category: 'decline-101', documented: 'Declined (101)', expect: 'unsupported', cvv: CVV3, note: 'JCB not processable on this account.' },
  { number: '135400000009712',  brand: 'UATP',       category: 'decline-101', documented: 'Declined (101)', expect: 'unsupported', cvv: CVV4, note: 'UATP not processable on this account.' },

  // ── Declined — code 102 (Referral B) ─────────────────────────────────────
  { number: '4000130000001724', brand: 'Visa',       category: 'decline-102', documented: 'Referral B (102)', expect: 'declined',    cvv: CVV3, repr: true },
  { number: '5114630000009791', brand: 'Mastercard', category: 'decline-102', documented: 'Referral B (102)', expect: 'declined',    cvv: CVV3 },
  { number: '375425000000907',  brand: 'Amex',       category: 'decline-102', documented: 'Referral B (102)', expect: 'declined',    cvv: CVV4 },
  { number: '36256000000634',   brand: 'Diners',     category: 'decline-102', documented: 'Referral B (102)', expect: 'declined',    cvv: CVV3 },
  { number: '6011000000001028', brand: 'Discover',   category: 'decline-102', documented: 'Referral B (102)', expect: 'declined',    cvv: CVV3 },
  { number: '3566000000001024', brand: 'JCB',        category: 'decline-102', documented: 'Referral B (102)', expect: 'unsupported', cvv: CVV3, note: 'JCB not processable on this account.' },
  { number: '135400000007633',  brand: 'UATP',       category: 'decline-102', documented: 'Referral B (102)', expect: 'unsupported', cvv: CVV4, note: 'UATP not processable on this account.' },

  // ── Declined — code 103 (Lost/Stolen) ────────────────────────────────────
  { number: '4000160000004147', brand: 'Visa',       category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'declined',    cvv: CVV3, repr: true },
  { number: '5121220000006921', brand: 'Mastercard', category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'declined',    cvv: CVV3 },
  { number: '343452000000306',  brand: 'Amex',       category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'declined',    cvv: CVV4 },
  { number: '38865000000705',   brand: 'Diners',     category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'declined',    cvv: CVV3 },
  { number: '6011000000001036', brand: 'Discover',   category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'declined',    cvv: CVV3 },
  { number: '3566000000001032', brand: 'JCB',        category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'unsupported', cvv: CVV3, note: 'JCB not processable on this account.' },
  { number: '135400000000281',  brand: 'UATP',       category: 'decline-103', documented: 'Lost/Stolen (103)', expect: 'unsupported', cvv: CVV4, note: 'UATP not processable on this account.' },

  // ── Declined — code 200 (Communication Error) ────────────────────────────
  { number: '4009830000001985', brand: 'Visa',       category: 'decline-200', documented: 'Comm Error (200)', expect: 'declined',    cvv: CVV3, repr: true },
  { number: '5135020000005871', brand: 'Mastercard', category: 'decline-200', documented: 'Comm Error (200)', expect: 'declined',    cvv: CVV3 },
  { number: '372349000000852',  brand: 'Amex',       category: 'decline-200', documented: 'Comm Error (200)', expect: 'declined',    cvv: CVV4 },
  { number: '30450000000985',   brand: 'Diners',     category: 'decline-200', documented: 'Comm Error (200)', expect: 'declined',    cvv: CVV3 },
  { number: '6011000000002000', brand: 'Discover',   category: 'decline-200', documented: 'Comm Error (200)', expect: 'declined',    cvv: CVV3 },
  { number: '3566000000002006', brand: 'JCB',        category: 'decline-200', documented: 'Comm Error (200)', expect: 'unsupported', cvv: CVV3, note: 'JCB not processable on this account.' },
  { number: '135400000005637',  brand: 'UATP',       category: 'decline-200', documented: 'Comm Error (200)', expect: 'unsupported', cvv: CVV4, note: 'UATP not processable on this account.' },

  // ── Declined — code 111 (Strong Customer Authentication Required) ─────────
  { number: '4242420000000091', brand: 'Visa',       category: 'sca-111', documented: 'SCA Required (111)', expect: 'declined', cvv: CVV3, repr: true },
  { number: '5100000000000131', brand: 'Mastercard', category: 'sca-111', documented: 'SCA Required (111)', expect: 'declined', cvv: CVV3 },
  { number: '374205502001004',  brand: 'Amex',       category: 'sca-111', documented: 'SCA Required (111)', expect: 'declined', cvv: CVV4 },

  // ── 3-D Secure 2 — Visa (message version 2.2) ─────────────────────────────
  { number: '4222000006285344', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Auth Successful (ECI 05)',          expect: 'terminal', cvv: CVV3, repr: true },
  { number: '4222000009719489', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Auth Successful, No Method URL',    expect: 'terminal', cvv: CVV3 },
  { number: '4222000005218627', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Attempted But Not Successful (06)', expect: 'terminal', cvv: CVV3 },
  { number: '4222000002144131', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Auth Failed (ECI 07)',             expect: 'declined', cvv: CVV3, repr: true },
  { number: '4222000007275799', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Issuer Rejected (ECI 07)',         expect: 'declined', cvv: CVV3 },
  { number: '4222000008880910', brand: 'Visa', category: '3ds2-visa', documented: 'Frictionless — Could Not Be Performed (07)',       expect: 'terminal', cvv: CVV3 },
  { number: '4222000001227408', brand: 'Visa', category: '3ds2-visa', documented: 'Challenge — Challenge Required',                   expect: 'terminal', cvv: CVV3, repr: true },

  // ── 3-D Secure 2 — Mastercard (message version 2.2) ───────────────────────
  { number: '5354560000000004', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Auth Successful (ECI 02)',          expect: 'terminal', cvv: CVV3 },
  { number: '5571596304025153', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Auth Successful, No Method URL',    expect: 'terminal', cvv: CVV3 },
  { number: '5580364874958322', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Attempted But Not Successful (01)', expect: 'terminal', cvv: CVV3 },
  { number: '5540010585397800', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Auth Failed (ECI 00)',             expect: 'declined', cvv: CVV3 },
  { number: '5588312194362669', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Issuer Rejected (ECI 00)',         expect: 'declined', cvv: CVV3 },
  { number: '5520680211891022', brand: 'Mastercard', category: '3ds2-mc', documented: 'Frictionless — Could Not Be Performed (00)',       expect: 'terminal', cvv: CVV3 },
  { number: '5506874496684651', brand: 'Mastercard', category: '3ds2-mc', documented: 'Challenge — Challenge Required',                   expect: 'terminal', cvv: CVV3 },

  // ── Card Blocking (Enhanced Card ID Service) — standard approvable cards ───
  { number: '4400000000000008', brand: 'Visa',       category: 'card-blocking', documented: 'Standard Debit (00, CVV/AVS M)',     expect: 'terminal', cvv: CVV3 },
  { number: '4095790000000004', brand: 'Visa',       category: 'card-blocking', documented: 'Standard Credit (00, CVV/AVS M)',    expect: 'terminal', cvv: CVV3 },
  { number: '5200000000000007', brand: 'Mastercard', category: 'card-blocking', documented: 'Standard Debit (00, CVV/AVS M)',     expect: 'terminal', cvv: CVV3 },
  { number: '5275000000000007', brand: 'Mastercard', category: 'card-blocking', documented: 'Commercial Credit (00, CVV/AVS M)',  expect: 'terminal', cvv: CVV3 },
  { number: '5348500000000009', brand: 'Mastercard', category: 'card-blocking', documented: 'Commercial Credit (00, CVV/AVS M)',  expect: 'terminal', cvv: CVV3 },

  // ── DCC test cards — exercisable as cards (DCC visibility is account-provisioned)
  { number: '4006097467207025', brand: 'Visa', category: 'dcc', documented: 'DCC (no 3DS) — Approved, AUD', expect: 'terminal', cvv: CVV3, note: 'DCC offer visibility depends on account provisioning.' },
  { number: '4002933640008365', brand: 'Visa', category: 'dcc', documented: 'DCC (no 3DS) — Approved, EUR', expect: 'terminal', cvv: CVV3, note: 'DCC offer visibility depends on account provisioning.' },

  // ── Catalogued but NOT exercisable via plain hosted-card entry ────────────
  { number: '4622943123052970', brand: 'Visa',       category: 'network-token',  documented: 'Network token returned (exp 12/25)', expect: null, cvv: CVV3, note: 'Network-token issuance is not observable via /payment-status; needs CSS/network-token feature.' },
  { number: '5186151950000055', brand: 'Mastercard', category: 'network-token',  documented: 'Network token returned (exp 12/25)', expect: null, cvv: CVV3, note: 'Needs network-token feature.' },
  { number: '370295069663597',  brand: 'Amex',       category: 'network-token',  documented: 'Network token returned (exp 12/25)', expect: null, cvv: CVV4, note: 'Needs network-token feature.' },
  { number: '4395840190010011', brand: 'Visa',       category: 'click-to-pay',   documented: 'Frictionless Approval (exp 12/27, cvv 840)',           expect: null, cvv: '840', note: 'Click-to-Pay flow, not plain hosted-card entry.' },
  { number: '4395840118000110', brand: 'Visa',       category: 'click-to-pay',   documented: 'OTP Challenge — Approved (exp 12/27, cvv 240)',         expect: null, cvv: '240', note: 'Click-to-Pay flow.' },
  { number: '5120350100064537', brand: 'Mastercard', category: 'click-to-pay',   documented: 'Frictionless (any future expiry)',                     expect: null, cvv: CVV3, note: 'Click-to-Pay flow.' },
  { number: '5120350100064545', brand: 'Mastercard', category: 'click-to-pay',   documented: 'Approval (any future expiry)',                         expect: null, cvv: CVV3, note: 'Click-to-Pay flow.' },
  { number: '4391200100101497', brand: 'Visa',       category: 'thank-you-points', documented: 'Thank You Points — Successful',                      expect: null, cvv: CVV3, note: 'Loyalty/points feature; needs provisioning.' },
  { number: '5288519105988050', brand: 'Mastercard', category: 'thank-you-points', documented: 'Thank You Points — Successful',                      expect: null, cvv: CVV3, note: 'Loyalty/points feature; needs provisioning.' },
  { number: '4263970000005262', brand: 'Visa',       category: 'installments',   documented: 'Installments — Successful (amount-gated)',             expect: null, cvv: CVV3, note: 'Installments need installment config + specific amounts (100000/200000/160000/80000/75000/50000/45000).' },
  { number: '4000120000001154', brand: 'Visa',       category: 'installments',   documented: 'Installments — Declined',                              expect: null, cvv: CVV3, note: 'Installments feature.' },
  { number: '5425230000004415', brand: 'Mastercard', category: 'installments',   documented: 'Installments — Successful',                            expect: null, cvv: CVV3, note: 'Installments feature.' },
  { number: '5114610000004778', brand: 'Mastercard', category: 'installments',   documented: 'Installments — Declined',                              expect: null, cvv: CVV3, note: 'Installments feature.' },
];

/**
 * Wallet (Apple/Google Pay) amount-based triggers and Open-Banking test banks are
 * part of the published catalog but are driven through wallet / bank-redirect flows
 * that this hosted-card sample does not exercise. Catalogued here for completeness.
 */
export const NON_CARD_SCENARIOS = {
  walletAmountTriggers: {
    note: 'Apple Pay / Google Pay outcomes are amount-driven, not card-driven.',
    visa:       { '10.00': 'Approved (00)', '11.01': 'Declined (101)', '11.02': 'Referral B (102)', '11.03': 'Referral A (103)', '12.05': 'Comm Error (200)' },
    mastercard: { '20.00': 'Approved (00)', '21.01': 'Declined (101)', '21.02': 'Referral B (102)', '21.03': 'Referral A (103)', '22.05': 'Comm Error (200)' },
    other:      'Any other amount → Error (108)',
    avs:        'Visa $43.00-$43.06 / Mastercard $53.00-$53.06 trigger specific AVS postcode/address combinations.',
  },
  openBanking: [
    { bank: 'Natwest',      currency: 'GBP', result: 'Pending/Decline', note: 'Declines above balance. User 123456789012 / PIN 5-7-2-4-3-6.' },
    { bank: 'Lloyds',       currency: 'GBP', result: 'Pending only',    note: 'No webhook. User llr001 / Password123.' },
    { bank: 'Ozone Modelo', currency: 'GBP', result: 'Success/Pending', note: 'mits / mits.' },
    { bank: 'Commerzbank',  currency: 'EUR', result: 'Success only',    note: 'Germany selection required.' },
    { bank: 'Deutsche Bank',currency: 'EUR', result: 'Payment Not Complete', note: 'Germany selection required.' },
  ],
};

/** Cards the harness will actually drive (everything with a non-null `expect`). */
export const EXERCISABLE = CATALOG.filter((c) => c.expect !== null);
