/**
 * Coverage (claim type) catalog and bot behaviour toggles offered at signup
 * and in Settings. Client-safe: no secrets, no server imports.
 *
 * Coverage fields and documents are generic versions of the claim types used
 * by the original single-tenant setup script (auto, travel, home, fire,
 * health), plus life and business coverage.
 */
/**
 * Catalog content (claim types, fields, documents) is written in English and
 * French. Companies using another language get the English content; the
 * dashboard shows translated labels through the `catalog.*` dictionary keys.
 */
export type ContentLocale = 'en' | 'fr';
type L10n = Record<ContentLocale, string>;

/** Language used for seeded catalog content (DB rows) for a company language. */
export function contentLocale(locale: string | null | undefined): ContentLocale {
  return locale === 'fr' ? 'fr' : 'en';
}

export type CoverageType = 'AUTO' | 'HEALTH' | 'HOME' | 'FIRE' | 'LIFE' | 'TRAVEL' | 'BUSINESS';

export interface CoverageField {
  fieldName: string;
  /** string | text | date | time | number | boolean | array (photos) | document */
  fieldType: string;
  isRequired: boolean;
  label: L10n;
  extractionPrompt?: L10n;
}

export interface CoverageDocument {
  fieldName: string;
  isRequired: boolean;
  /** Photos are collected as an image array; other documents as files. */
  kind: 'photos' | 'document';
  label: L10n;
  help: L10n;
}

export interface CoverageDefinition {
  type: CoverageType;
  icon: string;
  label: L10n;
  description: L10n;
  keywords: string[];
  confidenceThreshold: number;
  fields: CoverageField[];
  documents: CoverageDocument[];
}

type FieldTuple = [fieldName: string, fieldType: string, isRequired: boolean, en: string, fr: string];
const f = (rows: FieldTuple[]): CoverageField[] =>
  rows.map(([fieldName, fieldType, isRequired, en, fr]) => ({ fieldName, fieldType, isRequired, label: { en, fr } }));

type DocTuple = [fieldName: string, kind: 'photos' | 'document', isRequired: boolean, en: string, fr: string, helpEn: string, helpFr: string];
const d = (rows: DocTuple[]): CoverageDocument[] =>
  rows.map(([fieldName, kind, isRequired, en, fr, helpEn, helpFr]) => ({ fieldName, kind, isRequired, label: { en, fr }, help: { en: helpEn, fr: helpFr } }));

export const COVERAGE_CATALOG: CoverageDefinition[] = [
  {
    type: 'AUTO', icon: '🚗',
    label: { en: 'Auto claim', fr: 'Sinistre automobile' },
    description: { en: 'Vehicle accidents, collisions, pile-ups and all vehicle damage', fr: 'Accidents de véhicules, collisions, carambolages et tous dommages automobiles' },
    keywords: ['accident', 'car', 'vehicle', 'collision', 'crash', 'driving', 'bumped', 'voiture', 'véhicule', 'auto', 'automobile', 'conduire', 'carambolage', 'accrochage', 'percuter', 'emboutir', 'tamponner'],
    confidenceThreshold: 0.8,
    fields: f([
      ['policyNumber', 'string', false, 'Policy number', 'Numéro de police'],
      ['insuredFullName', 'string', true, 'Insured full name', "Nom complet de l'assuré"],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['address', 'string', false, 'Address', 'Adresse'],
      ['birthDate', 'date', false, 'Date of birth', 'Date de naissance'],
      ['licenseNumber', 'string', false, "Driver's licence number", 'Numéro de permis'],
      ['vehicleMakeModel', 'string', true, 'Vehicle make and model', 'Marque et modèle du véhicule'],
      ['vehicleYear', 'number', false, 'Vehicle year', 'Année du véhicule'],
      ['vehicleRegistration', 'string', true, 'Licence plate', "Plaque d'immatriculation"],
      ['vehicleVin', 'string', false, 'Chassis number (VIN)', 'Numéro de châssis (VIN)'],
      ['incidentDate', 'date', true, 'Accident date', "Date de l'accident"],
      ['incidentTime', 'time', false, 'Accident time', "Heure de l'accident"],
      ['incidentLocation', 'string', true, 'Accident location', "Lieu de l'accident"],
      ['roadType', 'string', false, 'Road type', 'Type de route'],
      ['incidentDescription', 'text', true, 'What happened', "Description de l'accident"],
      ['otherDriverName', 'string', false, 'Other driver name', "Nom de l'autre conducteur"],
      ['otherDriverPhone', 'string', false, 'Other driver phone', "Téléphone de l'autre conducteur"],
      ['otherInsuranceCompany', 'string', false, "Other vehicle's insurer", "Assurance de l'autre véhicule"],
      ['witnessName', 'string', false, 'Witness name', 'Nom du témoin'],
      ['witnessPhone', 'string', false, 'Witness phone', 'Téléphone du témoin'],
      ['policeContacted', 'boolean', false, 'Police contacted', 'Police contactée'],
      ['policeReportNumber', 'string', false, 'Police report number', 'Numéro du PV'],
      ['damageDescription', 'text', true, 'Damage description', 'Description des dommages'],
      ['estimatedRepairCost', 'number', false, 'Estimated repair cost', 'Coût estimé des réparations'],
      ['injuriesOccurred', 'boolean', true, 'Were there injuries?', 'Y a-t-il eu des blessures ?'],
      ['injuryDescription', 'text', false, 'Injury description', 'Description des blessures'],
      ['medicalTreatmentRequired', 'boolean', false, 'Medical treatment required', 'Soins médicaux requis'],
      ['additionalNotes', 'text', false, 'Additional notes', 'Notes supplémentaires'],
    ]),
    documents: d([
      ['accidentPhotos', 'photos', true, 'Accident photos', "Photos de l'accident", '2 to 10 photos of the vehicle damage and the scene', "2 à 10 photos des dommages du véhicule et du lieu de l'accident"],
      ['driverLicenseDocument', 'document', true, "Driver's licence", 'Permis de conduire', 'Photo or scan of the driver’s licence', 'Photo ou scan du permis de conduire'],
      ['vehicleRegistrationDocument', 'document', true, 'Vehicle registration certificate', 'Carte grise', 'Photo or scan of the registration certificate', 'Photo ou scan de la carte grise'],
      ['accidentReportDocument', 'document', false, 'Joint accident report', 'Constat amiable', 'Signed joint report, if one was completed', 'Constat amiable signé, s’il a été rempli'],
      ['policeReportDocument', 'document', false, 'Police report', 'Procès-verbal de police', 'Police report, if the police attended', 'Procès-verbal, si la police est intervenue'],
    ]),
  },
  {
    type: 'HEALTH', icon: '🩺',
    label: { en: 'Health claim', fr: 'Sinistre santé' },
    description: { en: 'Medical care, hospital stays, emergencies and reimbursement of healthcare costs', fr: 'Soins médicaux, hospitalisation, urgences et remboursements de frais de santé' },
    keywords: ['medical', 'hospital', 'doctor', 'illness', 'sick', 'health', 'treatment', 'medicine', 'surgery', 'médical', 'hôpital', 'docteur', 'maladie', 'santé', 'soins', 'médicament', 'consultation', 'urgence', 'chirurgie'],
    confidenceThreshold: 0.8,
    fields: f([
      ['policyNumber', 'string', true, 'Health policy number', 'Numéro de police santé'],
      ['patientName', 'string', true, 'Patient name', 'Nom du patient'],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['patientAddress', 'string', false, 'Patient address', 'Adresse du patient'],
      ['treatmentDate', 'date', true, 'Treatment date', 'Date du traitement'],
      ['healthcareProvider', 'string', true, 'Healthcare provider', 'Prestataire de soins'],
      ['doctorName', 'string', false, 'Doctor name', 'Nom du médecin'],
      ['treatmentType', 'string', true, 'Type of treatment', 'Type de traitement'],
      ['treatmentDetails', 'text', true, 'Treatment details', 'Détails du traitement'],
      ['diagnosis', 'text', false, 'Diagnosis', 'Diagnostic'],
      ['totalCost', 'number', true, 'Total cost', 'Coût total'],
      ['receiptsAvailable', 'boolean', true, 'Receipts available', 'Reçus disponibles'],
    ]),
    documents: d([
      ['medicalInvoices', 'document', true, 'Medical invoices and receipts', 'Factures et reçus médicaux', 'Itemised invoices and payment receipts', 'Factures détaillées et reçus de paiement'],
      ['prescriptionDocument', 'document', false, 'Prescription', 'Ordonnance', 'Prescription for medicines, if any', 'Ordonnance pour les médicaments, le cas échéant'],
      ['medicalReport', 'document', false, 'Medical report', 'Rapport médical', 'Doctor’s report or discharge summary', 'Rapport du médecin ou compte rendu d’hospitalisation'],
    ]),
  },
  {
    type: 'HOME', icon: '🏠',
    label: { en: 'Home / property claim', fr: 'Sinistre habitation' },
    description: { en: 'Burglary, water damage, theft at home, vandalism and property damage', fr: 'Cambriolages, dégâts des eaux, vols à domicile, vandalisme et dommages à la propriété' },
    keywords: ['house', 'home', 'apartment', 'burglary', 'break-in', 'theft', 'stolen', 'water damage', 'leak', 'flood', 'vandalism', 'property', 'maison', 'domicile', 'vol', 'cambriolage', 'dégât', 'eau', 'propriété', 'habitation', 'appartement', 'vandalisme', 'effraction'],
    confidenceThreshold: 0.8,
    fields: f([
      ['policyNumber', 'string', true, 'Home policy number', 'Numéro de police habitation'],
      ['ownerName', 'string', true, 'Owner name', 'Nom du propriétaire'],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['propertyAddress', 'string', true, 'Property address', 'Adresse de la propriété'],
      ['propertyType', 'string', false, 'Property type', 'Type de propriété'],
      ['incidentDate', 'date', true, 'Incident date', "Date de l'incident"],
      ['incidentTime', 'time', false, 'Incident time', "Heure de l'incident"],
      ['incidentCause', 'string', true, 'Cause of the incident', "Cause de l'incident"],
      ['damageDescription', 'text', true, 'Damage description', 'Description des dommages'],
      ['stolenItems', 'text', false, 'Stolen items', 'Objets volés'],
      ['estimatedValue', 'number', false, 'Estimated value', 'Valeur estimée'],
      ['policeReported', 'boolean', false, 'Reported to the police', 'Déclaré à la police'],
      ['policeReportNumber', 'string', false, 'Police report number', 'Numéro du rapport de police'],
    ]),
    documents: d([
      ['damagePhotos', 'photos', true, 'Damage photos', 'Photos des dommages', 'Photos of the damaged areas and items', 'Photos des zones et objets endommagés'],
      ['proofOfOwnership', 'document', false, 'Proof of ownership / invoices', 'Justificatifs de propriété / factures', 'Invoices or proof of ownership for stolen or damaged items', 'Factures ou justificatifs pour les objets volés ou endommagés'],
      ['policeReportDocument', 'document', false, 'Police report', 'Rapport de police', 'Required for theft or vandalism', 'Nécessaire en cas de vol ou de vandalisme'],
      ['repairQuotes', 'document', false, 'Repair quotes', 'Devis de réparation', 'Quotes from repairers, if available', 'Devis des réparateurs, si disponibles'],
    ]),
  },
  {
    type: 'FIRE', icon: '🔥',
    label: { en: 'Fire claim', fr: 'Sinistre incendie' },
    description: { en: 'Fires, explosions, smoke damage and all damage caused by fire', fr: 'Incendies, explosions, dommages par fumée et tous dommages causés par le feu' },
    keywords: ['fire', 'burned', 'burnt', 'explosion', 'smoke', 'flames', 'firefighters', 'incendie', 'feu', 'brûlé', 'fumée', 'flamme', 'pompiers', 'brûlure', 'combustion'],
    confidenceThreshold: 0.9,
    fields: f([
      ['policyNumber', 'string', true, 'Fire policy number', 'Numéro de police incendie'],
      ['ownerName', 'string', true, 'Owner name', 'Nom du propriétaire'],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['propertyAddress', 'string', true, 'Property address', 'Adresse de la propriété'],
      ['fireDate', 'date', true, 'Date of the fire', "Date de l'incendie"],
      ['fireTime', 'time', false, 'Time of the fire', "Heure de l'incendie"],
      ['fireCause', 'string', true, 'Cause of the fire', "Cause de l'incendie"],
      ['emergencyServices', 'boolean', true, 'Emergency services contacted', "Services d'urgence contactés"],
      ['fireReportNumber', 'string', false, 'Fire brigade report number', 'Numéro du rapport des pompiers'],
      ['damageAssessment', 'text', true, 'Damage assessment', 'Évaluation des dommages'],
      ['totalDamageValue', 'number', false, 'Total damage value', 'Valeur totale des dommages'],
      ['injuriesOccurred', 'boolean', true, 'Were there injuries?', 'Y a-t-il eu des blessures ?'],
    ]),
    documents: d([
      ['damagePhotos', 'photos', true, 'Damage photos', 'Photos des dommages', 'Photos of the fire damage', "Photos des dégâts causés par l'incendie"],
      ['fireReportDocument', 'document', false, 'Fire brigade report', 'Rapport des pompiers', 'Report from the fire brigade, if they attended', 'Rapport des pompiers, s’ils sont intervenus'],
      ['repairQuotes', 'document', false, 'Repair quotes / inventory', 'Devis / inventaire des pertes', 'Quotes or a list of damaged property', 'Devis ou liste des biens endommagés'],
    ]),
  },
  {
    type: 'LIFE', icon: '🕊️',
    label: { en: 'Life claim', fr: 'Sinistre vie / décès' },
    description: { en: 'Death benefit and life insurance claims filed by beneficiaries', fr: "Capital décès et demandes d'assurance vie déposées par les bénéficiaires" },
    keywords: ['death', 'passed away', 'deceased', 'life insurance', 'beneficiary', 'funeral', 'décès', 'décédé', 'assurance vie', 'bénéficiaire', 'obsèques', 'funérailles'],
    confidenceThreshold: 0.85,
    fields: f([
      ['policyNumber', 'string', true, 'Life policy number', 'Numéro de police vie'],
      ['claimantName', 'string', true, 'Claimant name', 'Nom du demandeur'],
      ['phoneNumber', 'string', true, 'Claimant phone number', 'Téléphone du demandeur'],
      ['relationshipToInsured', 'string', true, 'Relationship to the insured', "Lien avec l'assuré"],
      ['insuredFullName', 'string', true, 'Insured full name', "Nom complet de l'assuré"],
      ['dateOfDeath', 'date', true, 'Date of death', 'Date du décès'],
      ['placeOfDeath', 'string', false, 'Place of death', 'Lieu du décès'],
      ['causeOfDeath', 'string', false, 'Cause of death', 'Cause du décès'],
      ['beneficiaryDetails', 'text', false, 'Beneficiary details', 'Informations sur les bénéficiaires'],
    ]),
    documents: d([
      ['deathCertificate', 'document', true, 'Death certificate', 'Acte de décès', 'Official death certificate', 'Acte de décès officiel'],
      ['claimantIdDocument', 'document', true, 'Claimant ID', "Pièce d'identité du demandeur", 'ID card or passport of the claimant', "Carte d'identité ou passeport du demandeur"],
      ['medicalReport', 'document', false, 'Medical report', 'Rapport médical', 'Medical certificate stating the cause, if available', 'Certificat médical indiquant la cause, si disponible'],
    ]),
  },
  {
    type: 'TRAVEL', icon: '✈️',
    label: { en: 'Travel claim', fr: 'Sinistre voyage' },
    description: { en: 'Trip cancellations, lost baggage, medical emergencies abroad and flight delays', fr: 'Annulations de voyage, bagages perdus, urgences médicales en voyage, retards de vol' },
    keywords: ['travel', 'trip', 'flight', 'plane', 'cancellation', 'baggage', 'luggage', 'delay', 'airport', 'holiday', 'voyage', 'avion', 'vol', 'annulation', 'bagages', 'vacances', 'tourisme', 'aéroport', 'retard', 'correspondance'],
    confidenceThreshold: 0.8,
    fields: f([
      ['policyNumber', 'string', true, 'Travel policy number', 'Numéro de police voyage'],
      ['travelerName', 'string', true, 'Traveller name', 'Nom du voyageur'],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['email', 'string', false, 'Email', 'E-mail'],
      ['destination', 'string', true, 'Destination', 'Destination'],
      ['departureDate', 'date', true, 'Departure date', 'Date de départ'],
      ['returnDate', 'date', true, 'Return date', 'Date de retour'],
      ['airline', 'string', false, 'Airline', 'Compagnie aérienne'],
      ['flightNumber', 'string', false, 'Flight number', 'Numéro de vol'],
      ['incidentType', 'string', true, 'Type of incident', "Type d'incident"],
      ['incidentDate', 'date', true, 'Incident date', "Date de l'incident"],
      ['incidentLocation', 'string', true, 'Incident location', "Lieu de l'incident"],
      ['incidentDescription', 'text', true, 'Incident description', "Description de l'incident"],
      ['totalCost', 'number', false, 'Total cost', 'Coût total'],
      ['receiptsAvailable', 'boolean', false, 'Receipts available', 'Reçus disponibles'],
    ]),
    documents: d([
      ['travelDocuments', 'document', true, 'Tickets / booking confirmation', 'Billets / confirmation de réservation', 'Tickets, boarding passes or booking confirmation', "Billets, cartes d'embarquement ou confirmation de réservation"],
      ['receipts', 'document', true, 'Receipts for expenses', 'Reçus des dépenses', 'Receipts for the costs being claimed', 'Reçus des frais réclamés'],
      ['carrierReport', 'document', false, 'Airline / carrier report', 'Attestation de la compagnie', 'Delay, cancellation or lost-baggage report', 'Attestation de retard, d’annulation ou de perte de bagages'],
      ['medicalReport', 'document', false, 'Medical report', 'Rapport médical', 'For medical emergencies abroad', 'Pour les urgences médicales à l’étranger'],
    ]),
  },
  {
    type: 'BUSINESS', icon: '🏢',
    label: { en: 'Business claim', fr: 'Sinistre professionnel' },
    description: { en: 'Commercial property damage, business interruption, liability and professional losses', fr: "Dommages aux locaux professionnels, pertes d'exploitation, responsabilité civile et pertes professionnelles" },
    keywords: ['business', 'shop', 'store', 'office', 'warehouse', 'stock', 'liability', 'commercial', 'entreprise', 'boutique', 'magasin', 'bureau', 'entrepôt', 'marchandise', 'responsabilité', 'professionnel', 'commerce'],
    confidenceThreshold: 0.8,
    fields: f([
      ['policyNumber', 'string', true, 'Business policy number', 'Numéro de police professionnelle'],
      ['businessName', 'string', true, 'Business name', "Nom de l'entreprise"],
      ['contactName', 'string', true, 'Contact person', 'Personne de contact'],
      ['phoneNumber', 'string', true, 'Phone number', 'Numéro de téléphone'],
      ['incidentDate', 'date', true, 'Incident date', "Date de l'incident"],
      ['incidentLocation', 'string', true, 'Incident location', "Lieu de l'incident"],
      ['incidentType', 'string', true, 'Type of incident', "Type d'incident"],
      ['incidentDescription', 'text', true, 'Incident description', "Description de l'incident"],
      ['estimatedLoss', 'number', false, 'Estimated loss', 'Perte estimée'],
      ['thirdPartiesInvolved', 'text', false, 'Third parties involved', 'Tiers impliqués'],
    ]),
    documents: d([
      ['lossEvidence', 'document', true, 'Proof of loss', 'Justificatifs de la perte', 'Invoices, stock lists or accounts showing the loss', 'Factures, inventaires ou comptes justifiant la perte'],
      ['damagePhotos', 'photos', false, 'Damage photos', 'Photos des dommages', 'Photos of the damage, if any', 'Photos des dommages, le cas échéant'],
      ['policeReportDocument', 'document', false, 'Police report', 'Rapport de police', 'For theft, vandalism or third-party incidents', 'En cas de vol, de vandalisme ou d’incident avec un tiers'],
    ]),
  },
];

export const COVERAGE_TYPES = COVERAGE_CATALOG.map((c) => c.type);

export function coverageDefinition(type: string): CoverageDefinition | undefined {
  return COVERAGE_CATALOG.find((c) => c.type === type);
}

/**
 * On/off behaviour settings. Each is stored as a BOOLEAN row in `settings`
 * (name = key) and read by the WhatsApp bot (Go backend) or by the dashboard
 * API. Missing rows behave as `defaultValue`, so older tenants keep working.
 */
export const BEHAVIOR_TOGGLES = [
  {
    key: 'bot_require_claim_photos',
    defaultValue: true,
    usedBy: 'bot',
    label: { en: 'Ask for photos when a claim is filed', fr: 'Demander des photos lors d’une déclaration' },
    description: { en: 'The WhatsApp assistant asks the customer for photos of the damage (for coverage types that list photos).', fr: 'L’assistant WhatsApp demande au client des photos des dommages (pour les couvertures qui prévoient des photos).' },
  },
  {
    key: 'bot_require_claim_documents',
    defaultValue: true,
    usedBy: 'bot',
    label: { en: 'Ask for supporting documents', fr: 'Demander les pièces justificatives' },
    description: { en: 'The assistant asks for the documents configured for the claim type (licence, invoices, reports…).', fr: 'L’assistant demande les documents prévus pour le type de sinistre (permis, factures, rapports…).' },
  },
  {
    key: 'bot_human_handoff',
    defaultValue: true,
    usedBy: 'bot',
    label: { en: 'Hand off to a human agent', fr: 'Transfert vers un agent humain' },
    description: { en: 'When a customer is upset or asks for a person, the conversation is flagged for your team and the customer is told an agent will follow up.', fr: 'Si un client est mécontent ou demande une personne, la conversation est signalée à votre équipe et le client est prévenu qu’un agent le recontactera.' },
  },
  {
    key: 'bot_claim_status_lookup',
    defaultValue: true,
    usedBy: 'bot',
    label: { en: 'Let customers check claim status', fr: 'Permettre aux clients de suivre leurs sinistres' },
    description: { en: 'Customers can ask the assistant for the status of their existing claims.', fr: 'Les clients peuvent demander à l’assistant où en sont leurs sinistres.' },
  },
  {
    key: 'notify_customer_status_updates',
    defaultValue: true,
    usedBy: 'dashboard',
    label: { en: 'Notify customers when a claim status changes', fr: 'Prévenir le client quand le statut change' },
    description: { en: 'When an agent changes a claim’s status in the dashboard, the customer receives a WhatsApp update.', fr: 'Quand un agent change le statut d’un sinistre dans le tableau de bord, le client reçoit une mise à jour WhatsApp.' },
  },
  {
    key: 'bot_reply_in_customer_language',
    defaultValue: true,
    usedBy: 'bot',
    label: { en: 'Reply in the customer’s language', fr: 'Répondre dans la langue du client' },
    description: { en: 'If a customer writes in another language than the company’s, the assistant detects it and replies in the customer’s language. When off, it always replies in the company’s language.', fr: 'Si un client écrit dans une autre langue que celle de l’entreprise, l’assistant la détecte et lui répond dans sa langue. Désactivé, il répond toujours dans la langue de l’entreprise.' },
  },
] as const;

export type BehaviorToggleKey = (typeof BEHAVIOR_TOGGLES)[number]['key'];
export type BehaviorToggles = Record<BehaviorToggleKey, boolean>;

export const BEHAVIOR_TOGGLE_KEYS = BEHAVIOR_TOGGLES.map((t) => t.key) as BehaviorToggleKey[];

export function defaultBehaviorToggles(): BehaviorToggles {
  return Object.fromEntries(BEHAVIOR_TOGGLES.map((t) => [t.key, t.defaultValue])) as BehaviorToggles;
}

export function isBehaviorToggleKey(name: string): name is BehaviorToggleKey {
  return (BEHAVIOR_TOGGLE_KEYS as string[]).includes(name);
}
