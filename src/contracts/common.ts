import * as Schema from "effect/Schema"

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0))
const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))
const SchemaVersion = Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/))
const CountryCode = Schema.String.pipe(Schema.pattern(/^[A-Z]{2}$/))
const NonEmptyString = Schema.String.pipe(Schema.minLength(1))

export const PIIRecordId = Schema.UUID
export const PIIStorageKey = NonEmptyString

export const EntityType = Schema.Literal("AGGREGATE", "SNAPSHOT")
export type EntityType = typeof EntityType.Type

export const ApplicableLaw = Schema.Literal("GDPR", "CCPA", "LGPD", "PDPA", "PIPL", "152-FZ", "OTHER")
export type ApplicableLaw = typeof ApplicableLaw.Type

export const EncryptionAlgorithm = Schema.Literal("AES-256-GCM", "AES-256-CBC", "ChaCha20-Poly1305")
export type EncryptionAlgorithm = typeof EncryptionAlgorithm.Type

export const PIIRecordStatus = Schema.Literal("ACTIVE", "ANONYMIZED", "DELETED", "PENDING_DELETION")
export type PIIRecordStatus = typeof PIIRecordStatus.Type

export const PIIStateStatus = Schema.Literal("empty", "ACTIVE", "ANONYMIZED", "DELETED", "PENDING_DELETION")
export type PIIStateStatus = typeof PIIStateStatus.Type

export const ConsentPurpose = Schema.Literal(
  "PROFILE_MATCHING",
  "COMMUNICATION",
  "ANALYTICS",
  "MARKETING",
  "LEGAL_COMPLIANCE"
)
export type ConsentPurpose = typeof ConsentPurpose.Type

export const DataSubjectRequestType = Schema.Literal(
  "ACCESS",
  "RECTIFICATION",
  "ERASURE",
  "PORTABILITY",
  "RESTRICTION",
  "OBJECTION"
)
export type DataSubjectRequestType = typeof DataSubjectRequestType.Type

export const DataSubjectRequestStatus = Schema.Literal("PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED")
export type DataSubjectRequestStatus = typeof DataSubjectRequestStatus.Type

export const ActorType = Schema.Literal("USER", "SYSTEM", "ADMIN")
export type ActorType = typeof ActorType.Type

export const AuditAction = Schema.Literal("CREATE", "READ", "UPDATE", "DELETE")
export type AuditAction = typeof AuditAction.Type

export class EntityReference extends Schema.Class<EntityReference>("PIIEntityReference")({
  entityId: Schema.UUID,
  entityType: EntityType,
  entityVersion: PositiveInt
}) {}

export const storageKeyFromEntityReference = (reference: EntityReference) =>
  `${reference.entityType.toLowerCase()}:${reference.entityId}:${reference.entityVersion}`

export class Jurisdiction extends Schema.Class<Jurisdiction>("PIIJurisdiction")({
  countryCode: CountryCode,
  region: Schema.optional(Schema.String),
  applicableLaws: Schema.Array(ApplicableLaw),
  dataResidency: Schema.optional(CountryCode)
}) {}

export class EncryptionInfo extends Schema.Class<EncryptionInfo>("PIIEncryptionInfo")({
  keyId: Schema.String,
  algorithm: EncryptionAlgorithm,
  keyVersion: Schema.optional(PositiveInt),
  encryptedAt: Schema.optional(Schema.DateTimeUtc)
}) {}

export class FullName extends Schema.Class<FullName>("PIIFullName")({
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  middleName: Schema.optional(Schema.String),
  maidenName: Schema.optional(Schema.String)
}) {}

export class NationalId extends Schema.Class<NationalId>("PIINationalId")({
  type: Schema.Literal("PASSPORT", "ID_CARD", "SSN", "INN", "SNILS", "OTHER"),
  number: Schema.String,
  issuedBy: Schema.optional(Schema.String),
  issuedDate: Schema.optional(Schema.String),
  expiryDate: Schema.optional(Schema.String)
}) {}

export class PersonalIdentity extends Schema.Class<PersonalIdentity>("PIIPersonalIdentity")({
  fullName: Schema.optional(FullName),
  birthDate: Schema.optional(Schema.String),
  birthPlace: Schema.optional(Schema.String),
  gender: Schema.optional(Schema.String),
  citizenship: Schema.optional(Schema.Array(Schema.String)),
  nationalId: Schema.optional(NationalId)
}) {}

export class PhoneContact extends Schema.Class<PhoneContact>("PIIPhoneContact")({
  number: Schema.String,
  type: Schema.Literal("MOBILE", "HOME", "WORK", "OTHER"),
  verified: Schema.optional(Schema.Boolean)
}) {}

export class EmailContact extends Schema.Class<EmailContact>("PIIEmailContact")({
  address: Schema.String,
  type: Schema.Literal("PERSONAL", "WORK", "OTHER"),
  verified: Schema.optional(Schema.Boolean)
}) {}

export class AddressContact extends Schema.Class<AddressContact>("PIIAddressContact")({
  type: Schema.Literal("RESIDENCE", "REGISTRATION", "WORK", "OTHER"),
  country: Schema.String,
  region: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  postalCode: Schema.optional(Schema.String),
  street: Schema.optional(Schema.String)
}) {}

export class MessengerContact extends Schema.Class<MessengerContact>("PIIMessengerContact")({
  platform: Schema.Literal("TELEGRAM", "WHATSAPP", "VIBER", "DISCORD", "SKYPE", "OTHER"),
  identifier: Schema.String
}) {}

export class ContactData extends Schema.Class<ContactData>("PIIContactData")({
  phones: Schema.optional(Schema.Array(PhoneContact)),
  emails: Schema.optional(Schema.Array(EmailContact)),
  addresses: Schema.optional(Schema.Array(AddressContact)),
  messengers: Schema.optional(Schema.Array(MessengerContact))
}) {}

export class PhotoReference extends Schema.Class<PhotoReference>("PIIPhotoReference")({
  url: Schema.String,
  type: Schema.Literal("PROFILE", "DOCUMENT", "OTHER")
}) {}

export class BiometricData extends Schema.Class<BiometricData>("PIIBiometricData")({
  photoUrls: Schema.optional(Schema.Array(PhotoReference)),
  faceEncodingHash: Schema.optional(Schema.String)
}) {}

export class BankAccount extends Schema.Class<BankAccount>("PIIBankAccount")({
  bankName: Schema.optional(Schema.String),
  accountNumber: Schema.optional(Schema.String),
  bic: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String)
}) {}

export class CryptoWallet extends Schema.Class<CryptoWallet>("PIICryptoWallet")({
  blockchain: Schema.String,
  address: Schema.String
}) {}

export class FinancialData extends Schema.Class<FinancialData>("PIIFinancialData")({
  bankAccounts: Schema.optional(Schema.Array(BankAccount)),
  cryptoWallets: Schema.optional(Schema.Array(CryptoWallet)),
  taxId: Schema.optional(Schema.String)
}) {}

export class SocialProfile extends Schema.Class<SocialProfile>("PIISocialProfile")({
  platform: Schema.Literal("LINKEDIN", "GITHUB", "FACEBOOK", "TWITTER", "INSTAGRAM", "VK", "OTHER"),
  profileUrl: Schema.String,
  username: Schema.optional(Schema.String)
}) {}

export class SensitivePIIData extends Schema.Class<SensitivePIIData>("SensitivePIIData")({
  personalIdentity: Schema.optional(PersonalIdentity),
  contactData: Schema.optional(ContactData),
  biometricData: Schema.optional(BiometricData),
  financialData: Schema.optional(FinancialData),
  socialProfiles: Schema.optional(Schema.Array(SocialProfile))
}) {}

export class ConsentState extends Schema.Class<ConsentState>("PIIConsentState")({
  given: Schema.Boolean,
  givenAt: Schema.optional(Schema.DateTimeUtc),
  consentVersion: Schema.optional(Schema.String),
  purposes: Schema.optional(Schema.Array(ConsentPurpose)),
  withdrawalRequested: Schema.optional(Schema.Boolean),
  withdrawalDate: Schema.optional(Schema.DateTimeUtc)
}) {}

export class DataSubjectRequest extends Schema.Class<DataSubjectRequest>("PIIDataSubjectRequest")({
  requestId: Schema.UUID,
  requestType: DataSubjectRequestType,
  requestedAt: Schema.DateTimeUtc,
  status: DataSubjectRequestStatus,
  completedAt: Schema.optional(Schema.DateTimeUtc),
  notes: Schema.optional(Schema.String)
}) {}

export class RetentionInfo extends Schema.Class<RetentionInfo>("PIIRetentionInfo")({
  policyId: Schema.optional(Schema.String),
  retentionPeriodDays: Schema.optional(PositiveInt),
  expiresAt: Schema.optional(Schema.DateTimeUtc),
  legalHold: Schema.optional(Schema.Boolean)
}) {}

export class AuditSummary extends Schema.Class<AuditSummary>("PIIAuditSummary")({
  createdAt: Schema.DateTimeUtc,
  createdBy: Schema.UUID,
  lastAccessedAt: Schema.optional(Schema.DateTimeUtc),
  lastAccessedBy: Schema.optional(Schema.UUID),
  accessCount: Schema.optional(NonNegativeInt),
  lastModifiedAt: Schema.optional(Schema.DateTimeUtc)
}) {}

export class ExtractionInfo extends Schema.Class<ExtractionInfo>("PIIExtractionInfo")({
  extractedFields: Schema.optional(Schema.Array(Schema.String)),
  extractionMethod: Schema.optional(Schema.Literal("LLM_DETECTION", "REGEX_PATTERN", "MANUAL", "HYBRID")),
  confidenceScores: Schema.optional(Schema.Record({ key: Schema.String, value: NonNegativeNumber }))
}) {}

export class PIIRecordInput extends Schema.Class<PIIRecordInput>("PIIRecordInput")({
  id: PIIRecordId,
  schemaVersion: SchemaVersion,
  entityReference: EntityReference,
  jurisdiction: Jurisdiction,
  personalIdentity: Schema.optional(PersonalIdentity),
  contactData: Schema.optional(ContactData),
  biometricData: Schema.optional(BiometricData),
  financialData: Schema.optional(FinancialData),
  socialProfiles: Schema.optional(Schema.Array(SocialProfile)),
  consent: ConsentState,
  dataSubjectRequests: Schema.optional(Schema.Array(DataSubjectRequest)),
  retention: Schema.optional(RetentionInfo),
  audit: AuditSummary,
  extractionInfo: Schema.optional(ExtractionInfo),
  status: PIIRecordStatus
}) {}

export class PIIRecordDocument extends Schema.Class<PIIRecordDocument>("PIIRecordDocument")({
  id: PIIRecordId,
  schemaVersion: SchemaVersion,
  entityReference: EntityReference,
  jurisdiction: Jurisdiction,
  encryption: EncryptionInfo,
  personalIdentity: Schema.optional(PersonalIdentity),
  contactData: Schema.optional(ContactData),
  biometricData: Schema.optional(BiometricData),
  financialData: Schema.optional(FinancialData),
  socialProfiles: Schema.optional(Schema.Array(SocialProfile)),
  consent: ConsentState,
  dataSubjectRequests: Schema.optional(Schema.Array(DataSubjectRequest)),
  retention: Schema.optional(RetentionInfo),
  audit: AuditSummary,
  extractionInfo: Schema.optional(ExtractionInfo),
  status: PIIRecordStatus
}) {}

export class EncryptedPayload extends Schema.Class<EncryptedPayload>("PIIEncryptedPayload")({
  encryptedData: Schema.String,
  encryptedDek: Schema.String,
  encryption: EncryptionInfo
}) {}

export class AuditEntry extends Schema.Class<AuditEntry>("PIIAuditEntry")({
  id: Schema.UUID,
  action: AuditAction,
  actorId: Schema.UUID,
  actorType: ActorType,
  ipAddress: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
  accessedAt: Schema.DateTimeUtc,
  success: Schema.Boolean,
  failureReason: Schema.optional(Schema.String),
  purpose: Schema.optional(Schema.String)
}) {}

export class PIIAuditLog extends Schema.Class<PIIAuditLog>("PIIAuditLog")({
  storageKey: PIIStorageKey,
  auditEntries: Schema.Array(AuditEntry),
  total: NonNegativeInt
}) {}

export class PIIRevisionEntry extends Schema.Class<PIIRevisionEntry>("PIIRevisionEntry")({
  revision: Schema.Number.pipe(Schema.int()),
  eventType: Schema.String,
  summary: Schema.String,
  occurredAt: Schema.DateTimeUtc,
  actorId: Schema.UUID
}) {}

export const sensitiveDataFromInput = (record: PIIRecordInput) =>
  new SensitivePIIData({
    personalIdentity: record.personalIdentity,
    contactData: record.contactData,
    biometricData: record.biometricData,
    financialData: record.financialData,
    socialProfiles: record.socialProfiles
  })
