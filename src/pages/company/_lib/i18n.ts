/**
 * Company Brain strings. Registered as namespaces of the platform's i18next
 * instance, so they follow the platform's detected language (English fallback).
 * Add a key to both `en` and `de`.
 */
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import deDocuments from '@/i18n/locales/de/company/documents.json';
import enDocuments from '@/i18n/locales/en/company/documents.json';

export const DOCUMENTS_NS = 'company-documents';

const RESOURCES: Record<string, Record<string, unknown>> = { de: deDocuments, en: enDocuments };
for (const [lng, resources] of Object.entries(RESOURCES)) {
  if (!i18n.hasResourceBundle(lng, DOCUMENTS_NS)) i18n.addResourceBundle(lng, DOCUMENTS_NS, resources, true, true);
}

/** `t` for the Documents view and its file dialog. */
export function useDocumentsT() {
  return useTranslation(DOCUMENTS_NS).t;
}
