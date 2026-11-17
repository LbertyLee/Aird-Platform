import { http } from './http';

export type LegalDocument = {
  content: string;
  version: string;
  updatedAt: string;
  effectiveAt: string;
};

export type LegalDocuments = {
  userAgreement: LegalDocument;
  privacyPolicy: LegalDocument;
};

export async function fetchLegalDocuments(): Promise<LegalDocuments> {
  const { data } = await http.get<LegalDocuments>(
    '/admin/dictionaries/public/legal-documents',
  );
  return data;
}
