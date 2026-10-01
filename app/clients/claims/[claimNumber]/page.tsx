'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useCurrentUser } from '@/components/CurrentUser';
import { useI18n } from '@/components/I18nProvider';
import { claimStatusLabel, claimTypeLabel, CLAIM_STATUSES } from '@/lib/i18n/claimLabels';
import { downloadDocument, openDocument } from '@/lib/documentAccess';
import AuthedImage from '@/components/AuthedImage';


interface AutoClaimData {
  id: string;
  policyNumber: string;
  insuredFullName: string;
  phoneNumber: string;
  address: string;
  email?: string;
  birthDate: string;
  licenseNumber: string;
  vehicleMakeModel: string;
  vehicleYear: number;
  vehicleRegistration: string;
  vehicleVin: string;
  incidentLocation: string;
  roadType?: string;
  otherDriverName?: string;
  otherDriverPhone?: string;
  otherInsuranceCompany?: string;
  otherPolicyNumber?: string;
  otherVehicleRegistration?: string;
  witnessName?: string;
  witnessPhone?: string;
  policeContacted: boolean;
  policeReportNumber?: string;
  damageDescription: string;
  estimatedRepairCost?: number;
  injuriesOccurred: boolean;
  injuryDescription?: string;
  medicalTreatmentRequired: boolean;
  additionalNotes?: string;
  totalPhotosUploaded: number;
  // Media fields from WhatsApp uploads
  DamagePhotos?: string[];
  PoliceReportDocument?: string;
  MediaUploads?: string[];
}

interface ClaimDocument {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

interface ClaimNote {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface ClaimStatusHistory {
  id: string;
  fromStatus?: string;
  toStatus: string;
  reason?: string;
  changedAt: string;
  changedBy: string;
}

interface Claim {
  id: string;
  claimNumber: string;
  type: string;
  status: string;
  description: string;
  estimatedAmount?: number;
  approvedAmount?: number;
  incidentDate: string;
  incidentTime?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  completedAt?: string;
  customer: {
    id: string;
    firstName?: string;
    lastName?: string;
    phoneNumber: string;
    email?: string;
  };
  assignedAdmin?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  autoClaimData?: AutoClaimData;
  documents: ClaimDocument[];
  claimNotes: ClaimNote[];
  statusHistory: ClaimStatusHistory[];
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  company: {
    id: string;
    name: string;
    slug: string;
    domain: string;
    isActive: boolean;
  };
}

export default function ClaimDetailPage() {
  const router = useRouter();
  // Read-only roles see the claim but none of the edit/upload/status/message/note controls.
  const { canWrite } = useCurrentUser();
  const { t, intl } = useI18n();
  const money = (n: number) => (n || 0).toLocaleString(intl, { style: 'currency', currency: 'EUR' });
  const params = useParams();
  const claimNumber = params.claimNumber as string;
  
  const [claim, setClaim] = useState<Claim | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('details');
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [directMessageText, setDirectMessageText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState<'download' | 'regenerate' | null>(null);
  // Edit form state
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    description: '',
    incidentDate: '',
    incidentTime: '',
    auto: {
      insuredFullName: '',
      phoneNumber: '',
      address: '',
      incidentLocation: '',
      damageDescription: '',
      policeContacted: false,
      injuriesOccurred: false,
      medicalTreatmentRequired: false,
    }
  });

  // Auto-dismiss notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    fetchData();
  }, [claimNumber]);

  useEffect(() => {
    if (claim) {
      console.log('🔍 Claim data loaded:', {
        claimNumber: claim.claimNumber,
        customer: {
          id: claim.customer.id,
          phoneNumber: claim.customer.phoneNumber,
          firstName: claim.customer.firstName,
          lastName: claim.customer.lastName
        }
      });
    }
  }, [claim]);

  // Initialize edit form when claim loads
  useEffect(() => {
    if (!claim) return;
    const coerceBool = (v: any) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return Boolean(v);
    };
    setEditForm({
      description: claim.description || '',
      incidentDate: claim.incidentDate ? new Date(claim.incidentDate).toISOString().slice(0, 10) : '',
      incidentTime: claim.incidentTime || '',
      auto: {
        insuredFullName: claim.autoClaimData?.insuredFullName || '',
        phoneNumber: claim.autoClaimData?.phoneNumber || claim.customer.phoneNumber || '',
        address: claim.autoClaimData?.address || '',
        incidentLocation: claim.autoClaimData?.incidentLocation || '',
        damageDescription: claim.autoClaimData?.damageDescription || '',
        policeContacted: coerceBool((claim.autoClaimData as any)?.policeContacted),
        injuriesOccurred: coerceBool((claim.autoClaimData as any)?.injuriesOccurred),
        medicalTreatmentRequired: coerceBool((claim.autoClaimData as any)?.medicalTreatmentRequired),
      }
    });
  }, [claim]);

  const saveEdits = async () => {
    if (!claim || savingEdit) return;
    try {
      setSavingEdit(true);
      const body: any = {
        description: editForm.description || undefined,
        incidentDate: editForm.incidentDate || undefined,
        incidentTime: editForm.incidentTime || undefined,
        autoClaimData: {
          insuredFullName: editForm.auto.insuredFullName || undefined,
          phoneNumber: editForm.auto.phoneNumber || undefined,
          address: editForm.auto.address || undefined,
          incidentLocation: editForm.auto.incidentLocation || undefined,
          damageDescription: editForm.auto.damageDescription || undefined,
          policeContacted: editForm.auto.policeContacted,
          injuriesOccurred: editForm.auto.injuriesOccurred,
          medicalTreatmentRequired: editForm.auto.medicalTreatmentRequired,
        }
      };
      const res = await authedFetch(`/api/clients/0/claims/${claim.claimNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('claimDetail.saveError'));
      }
  await res.json();
      setNotification({ message: t('claimDetail.claimUpdated'), type: 'success' });
      setEditOpen(false);
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('claimDetail.updateFailed', { message: msg }), type: 'error' });
    } finally {
      setSavingEdit(false);
    }
  };

  // Client edit state
  const [clientEditOpen, setClientEditOpen] = useState(false);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientForm, setClientForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '' });

  useEffect(() => {
    if (!claim) return;
    setClientForm({
      firstName: claim.customer.firstName || '',
      lastName: claim.customer.lastName || '',
      phoneNumber: claim.customer.phoneNumber || '',
      email: claim.customer.email || '',
    });
  }, [claim]);

  const saveClient = async () => {
    if (!claim || clientSaving) return;
    try {
      setClientSaving(true);
      const res = await authedFetch(`/api/agents/customers/${claim.customer.id}` , {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: clientForm.firstName || undefined,
          lastName: clientForm.lastName || undefined,
          phoneNumber: clientForm.phoneNumber || undefined,
          email: clientForm.email || undefined,
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('claimDetail.clientUpdateError'));
      }
      await res.json();
      setNotification({ message: t('claimDetail.clientUpdated'), type: 'success' });
      setClientEditOpen(false);
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('claimDetail.clientUpdateFailed', { message: msg }), type: 'error' });
    } finally {
      setClientSaving(false);
    }
  };

  // Auto-claim detailed edit
  const [autoEditOpen, setAutoEditOpen] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoForm, setAutoForm] = useState({
    policyNumber: '',
    insuredFullName: '',
    phoneNumber: '',
    address: '',
    email: '',
    birthDate: '',
    licenseNumber: '',
    vehicleMakeModel: '',
    vehicleYear: '' as number | string,
    vehicleRegistration: '',
    vehicleVin: '',
    incidentLocation: '',
    roadType: '',
    policeContacted: false,
    policeReportNumber: '',
    damageDescription: '',
    estimatedRepairCost: '' as number | string,
    injuriesOccurred: false,
    injuryDescription: '',
    medicalTreatmentRequired: false,
    additionalNotes: ''
  });

  useEffect(() => {
    if (!claim?.autoClaimData) return;
    const ac = claim.autoClaimData as any;
    const coerce = (v: any) => (typeof v === 'string' ? v : v ?? '');
    const boolStrToBool = (v: any) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return false;
    };
    setAutoForm({
      policyNumber: coerce(ac.policyNumber),
      insuredFullName: coerce(ac.insuredFullName),
      phoneNumber: coerce(ac.phoneNumber),
      address: coerce(ac.address),
      email: coerce(ac.email),
      birthDate: ac.birthDate ? new Date(ac.birthDate).toISOString().slice(0,10) : '',
      licenseNumber: coerce(ac.licenseNumber),
      vehicleMakeModel: coerce(ac.vehicleMakeModel),
      vehicleYear: ac.vehicleYear ?? '',
      vehicleRegistration: coerce(ac.vehicleRegistration),
      vehicleVin: coerce(ac.vehicleVin),
      incidentLocation: coerce(ac.incidentLocation),
      roadType: coerce(ac.roadType),
      policeContacted: boolStrToBool(ac.policeContacted),
      policeReportNumber: coerce(ac.policeReportNumber),
      damageDescription: coerce(ac.damageDescription),
      estimatedRepairCost: ac.estimatedRepairCost ?? '',
      injuriesOccurred: boolStrToBool(ac.injuriesOccurred),
      injuryDescription: coerce(ac.injuryDescription),
      medicalTreatmentRequired: boolStrToBool(ac.medicalTreatmentRequired),
      additionalNotes: coerce(ac.additionalNotes)
    });
  }, [claim?.autoClaimData]);

  const saveAuto = async () => {
    if (!claim || autoSaving) return;
    try {
      setAutoSaving(true);
      const body: any = {
        autoClaimData: {
          policyNumber: autoForm.policyNumber || undefined,
          insuredFullName: autoForm.insuredFullName || undefined,
          phoneNumber: autoForm.phoneNumber || undefined,
          address: autoForm.address || undefined,
          email: autoForm.email || undefined,
          birthDate: autoForm.birthDate || undefined,
          licenseNumber: autoForm.licenseNumber || undefined,
          vehicleMakeModel: autoForm.vehicleMakeModel || undefined,
          vehicleYear: autoForm.vehicleYear === '' ? undefined : Number(autoForm.vehicleYear),
          vehicleRegistration: autoForm.vehicleRegistration || undefined,
          vehicleVin: autoForm.vehicleVin || undefined,
          incidentLocation: autoForm.incidentLocation || undefined,
          roadType: autoForm.roadType || undefined,
          policeContacted: autoForm.policeContacted,
          policeReportNumber: autoForm.policeReportNumber || undefined,
          damageDescription: autoForm.damageDescription || undefined,
          estimatedRepairCost: autoForm.estimatedRepairCost === '' ? undefined : Number(autoForm.estimatedRepairCost),
          injuriesOccurred: autoForm.injuriesOccurred,
          injuryDescription: autoForm.injuryDescription || undefined,
          medicalTreatmentRequired: autoForm.medicalTreatmentRequired,
          additionalNotes: autoForm.additionalNotes || undefined,
        }
      };
      const res = await authedFetch(`/api/clients/0/claims/${claim.claimNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('claimDetail.autoUpdateError'));
      }
      await res.json();
      setNotification({ message: t('claimDetail.autoUpdated'), type: 'success' });
      setAutoEditOpen(false);
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('claimDetail.autoUpdateFailed', { message: msg }), type: 'error' });
    } finally {
      setAutoSaving(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profileRes] = await Promise.all([
        authedFetch('/api/auth/profile')
      ]);

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData.user);
      }

      // Fetch claim data
      const claimRes = await authedFetch(`/api/clients/0/claims/${claimNumber}`);
      if (claimRes.ok) {
        const claimData = await claimRes.json();
        if (claimData.success) {
          console.log('📄 Claim documents loaded:', claimData.claim.documents);
          setClaim(claimData.claim);
          // Default-select first document for preview
          if (claimData.claim.documents && claimData.claim.documents.length > 0) {
            setSelectedDocumentIndex(0);
          } else {
            setSelectedDocumentIndex(null);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch claim data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      NEW: 'bg-blue-100 text-blue-800',
      ONGOING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      COMPLETED: 'bg-gray-100 text-gray-800'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getStatusText = (status: string) => claimStatusLabel(t, status);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f9fafb' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: '#374151' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: '#374151' }}>{t('claimDetail.loading')}</p>
            <p className="text-sm" style={{ color: '#6b7280' }}>{t('claimDetail.fetching')}</p>
          </div>
        </div>
      </div>
    );
  }

  const getCompanyName = () => {
    if (user?.company?.name) {
      return user.company.name;
    }
    
    if (user?.company?.slug) {
      return user.company.slug
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    
    return t('claimDetail.insurance');
  };

  const getTypeText = (type: string) => claimTypeLabel(t, type);

  const handleAddNote = async () => {
    if (!claim || !newNote.trim() || isAddingNote) return;

    setIsAddingNote(true);
    try {
      const response = await authedFetch(`/api/clients/0/claims/${claim.claimNumber}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: newNote.trim(),
          isInternal: false
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Refresh claim data to get updated notes
          await fetchData();
          setNewNote('');
        }
      }
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Documents and PDFs need the bearer token, so they are fetched and handed to the browser as blobs.
  const docUrl = (doc: { id: string }) => `/api/documents/${claim?.id}/${doc.id}`;
  const documentError = () => setNotification({ message: t('claimDetail.documentError'), type: 'error' });
  const openDoc = (doc: { id: string }) => { openDocument(docUrl(doc)).catch(documentError); };
  const downloadDoc = (doc: { id: string; fileName?: string }) => { downloadDocument(`${docUrl(doc)}?download=1`, doc.fileName || 'document').catch(documentError); };
  const downloadReport = async () => {
    if (!claim || pdfBusy) return;
    setPdfBusy('download');
    try {
      await downloadDocument(`/api/claims/${encodeURIComponent(claim.claimNumber)}/pdf?download=1`, `${claim.claimNumber}.pdf`);
    } catch {
      setNotification({ message: t('claimDetail.pdfError'), type: 'error' });
    } finally {
      setPdfBusy(null);
    }
  };
  const regenerateReport = async () => {
    if (!claim || pdfBusy) return;
    setPdfBusy('regenerate');
    try {
      const res = await authedFetch(`/api/claims/${encodeURIComponent(claim.claimNumber)}/pdf`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotification({ message: t('claimDetail.pdfGenerated'), type: 'success' });
      await fetchData();
    } catch {
      setNotification({ message: t('claimDetail.pdfError'), type: 'error' });
    } finally {
      setPdfBusy(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleFileUpload = async (files: FileList) => {
    if (!claim || uploadingFile) return;

    setUploadingFile(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        // The media upload API persists ClaimDocument and links it to this claimNumber
        formData.append('claimNumber', claim.claimNumber);
        formData.append('description', 'Uploaded from admin UI');

        const response = await authedFetch(`/api/media/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }
      }
      
      // Refresh claim data to show new documents
      await fetchData();
    } catch (error) {
      console.error('Error uploading files:', error);
      setNotification({ message: t('claimDetail.uploadError'), type: 'error' });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleStatusUpdate = async () => {
    if (!claim || !updateStatus || isUpdatingStatus) return;

    setIsUpdatingStatus(true);
    try {
      console.log('🔄 Updating status from', claim.status, 'to', updateStatus);
      console.log('📱 Customer phone:', claim.customer.phoneNumber);
      
      const requestData = {
        status: updateStatus,
        reason: t('claimDetail.statusReason', { status: getStatusText(updateStatus) }),
        autoGeneratePdf: true
      };
      
      console.log('📤 Sending status update request:', requestData);

      const response = await authedFetch(`/api/clients/0/claims/${claim.claimNumber}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      console.log('📡 Status update response:', response.status, response.statusText);

      if (response.ok) {
        const responseData = await response.json();
        console.log('✅ Status update successful:', responseData);
        
        // Refresh claim data
        await fetchData();
        setUpdateStatus('');
        
        // Show success message
        setNotification({ message: t('claimDetail.statusUpdated'), type: 'success' });
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ Status update failed:', errorData);
        throw new Error(errorData?.error || `HTTP ${response.status}: Failed to update status`);
      }
    } catch (error) {
      console.error('💥 Failed to update status:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setNotification({ message: t('claimDetail.statusUpdateError', { message: errorMessage }), type: 'error' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSendMessage = async () => {
    if (!claim || !directMessageText.trim() || isSendingMessage) return;

    setIsSendingMessage(true);
    try {
      const requestData = {
        phoneNumber: claim.customer.phoneNumber,
        message: directMessageText.trim()
      };
      
      console.log('🚀 Sending message with data:', requestData);
      console.log('📞 Phone number format:', claim.customer.phoneNumber, 'Length:', claim.customer.phoneNumber?.length);

      const response = await authedFetch('/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      console.log('📡 Response status:', response.status, response.statusText);

      if (response.ok) {
        const responseData = await response.json();
        console.log('✅ Success response:', responseData);
        setDirectMessageText('');
        setNotification({ message: t('claimDetail.messageSent'), type: 'success' });
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ Response error:', errorData);
        console.error('❌ Response headers:', response.headers);
        throw new Error(errorData?.error || `HTTP ${response.status}: ${t('claimDetail.messageSendFailed')}`);
      }
    } catch (error) {
      console.error('💥 Failed to send message:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setNotification({ message: t('claimDetail.messageSendError', { message: errorMessage }), type: 'error' });
    } finally {
      setIsSendingMessage(false);
    }
  };

  if (!claim) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <svg className="mx-auto h-24 w-24 mb-4" style={{ color: '#DEE1E6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-2xl font-bold mb-2" style={{ color: '#374151' }}>{t('claimDetail.notFound')}</h3>
          <p className="text-lg mb-6" style={{ color: '#6b7280' }}>{t('claimDetail.notFoundMessage')}</p>
          <button
            onClick={() => router.push('/claims')}
            className="text-white px-6 py-3 rounded-xl font-bold"
            style={{ backgroundColor: '#374151' }}
          >
            {t('claimDetail.backToClaims')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 end-4 z-50 px-6 py-4 rounded-lg shadow-lg transform transition-all duration-300 ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          <div className="flex items-center space-x-3 rtl:space-x-reverse">
            {notification.type === 'success' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ms-2 hover:opacity-75 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Chrome-inspired Claim Header */}
      <div className="relative py-16 overflow-hidden" style={{ backgroundColor: '#374151' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M30 30c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15zm15 0c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-block">
              <h1 className="text-6xl md:text-7xl font-black text-white tracking-tight">
                #{claim.claimNumber}
              </h1>
              <div className="h-1 mt-4 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#d1d5db' }}>
              {t('claimDetail.headerSubtitle', { type: getTypeText(claim.type), company: getCompanyName() })}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#d1d5db' }}>
                <span className={`px-3 py-1 text-sm font-bold rounded-full ${getStatusColor(claim.status)}`}>
                  {getStatusText(claim.status)}
                </span>
              </div>
              <div className="flex items-center" style={{ color: '#d1d5db' }}>
                <span className="text-sm font-medium">
                  {claim.customer.firstName && claim.customer.lastName 
                    ? `${claim.customer.firstName} ${claim.customer.lastName}`
                    : claim.customer.phoneNumber
                  }
                </span>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3" aria-label={t('claimDetail.pdfReport')}>
              <button
                type="button"
                data-testid="download-claim-pdf"
                onClick={downloadReport}
                disabled={pdfBusy !== null}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-white text-gray-800 font-semibold shadow hover:bg-gray-100 disabled:opacity-60"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {pdfBusy === 'download' ? t('common.loading') : t('claimDetail.downloadPdf')}
              </button>
              {canWrite && (
                <button
                  type="button"
                  data-write-action="regenerate-pdf"
                  onClick={regenerateReport}
                  disabled={pdfBusy !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-100 font-medium hover:bg-gray-600 disabled:opacity-60"
                >
                  {pdfBusy === 'regenerate' ? t('common.loading') : t('claimDetail.regeneratePdf')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          
          {/* Tab Navigation */}
          <div className="mb-8">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8 rtl:space-x-reverse">
                {[
                  { id: 'details', name: t('claimDetail.tabDetails'), icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                  { id: 'documents', name: t('claimDetail.tabDocuments'), icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
                  { id: 'progression', name: t('claimDetail.tabProgress'), icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
                  { id: 'notes', name: t('claimDetail.tabNotes'), icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 rtl:space-x-reverse ${
                      activeTab === tab.id
                        ? 'border-gray-500 text-gray-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                    </svg>
                    <span>{tab.name}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
          {/* Tab Content */}
          {activeTab === 'details' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Basic Information */}
              <div className="bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
                <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                  <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.generalInfo')}</h2>
                </div>
                <div className="p-6 space-y-6">
                    {/* Inline edit toggle */}
                    {canWrite && (
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-500">{t('claimDetail.agentEdit')}</div>
                      <button
                        data-write-action="edit-claim"
                        onClick={() => setEditOpen(!editOpen)}
                        className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {editOpen ? t('claimDetail.close') : t('claimDetail.edit')}
                      </button>
                    </div>
                    )}

                    {canWrite && editOpen && (
                      <div className="p-4 rounded-lg border space-y-4" style={{ borderColor: '#e5e7eb' }}>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.description')}</label>
                          <textarea
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            rows={3}
                            className="w-full p-2 border rounded"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.incidentDate')}</label>
                            <input
                              type="date"
                              value={editForm.incidentDate}
                              onChange={(e) => setEditForm({ ...editForm, incidentDate: e.target.value })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.incidentTime24')}</label>
                            <input
                              type="time"
                              value={editForm.incidentTime}
                              onChange={(e) => setEditForm({ ...editForm, incidentTime: e.target.value })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.insuredFullNameEdit')}</label>
                            <input
                              type="text"
                              value={editForm.auto.insuredFullName}
                              onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, insuredFullName: e.target.value } })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.phone')}</label>
                            <input
                              type="tel"
                              value={editForm.auto.phoneNumber}
                              onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, phoneNumber: e.target.value } })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.address')}</label>
                            <input
                              type="text"
                              value={editForm.auto.address}
                              onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, address: e.target.value } })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.incidentLocation')}</label>
                            <input
                              type="text"
                              value={editForm.auto.incidentLocation}
                              onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, incidentLocation: e.target.value } })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('claimDetail.damageDescriptionEdit')}</label>
                            <textarea
                              value={editForm.auto.damageDescription}
                              onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, damageDescription: e.target.value } })}
                              rows={3}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div className="flex items-center gap-6 md:col-span-2">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editForm.auto.policeContacted}
                                onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, policeContacted: e.target.checked } })}
                              />
                              {t('claimDetail.policeContactedEdit')}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editForm.auto.injuriesOccurred}
                                onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, injuriesOccurred: e.target.checked } })}
                              />
                              {t('claimDetail.injuriesOccurredEdit')}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editForm.auto.medicalTreatmentRequired}
                                onChange={(e) => setEditForm({ ...editForm, auto: { ...editForm.auto, medicalTreatmentRequired: e.target.checked } })}
                              />
                              {t('claimDetail.medicalTreatmentEdit')}
                            </label>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditOpen(false)}
                            className="px-4 py-2 text-sm rounded-lg border border-gray-300"
                            disabled={savingEdit}
                          >
                            {t('claimDetail.cancel')}
                          </button>
                          <button
                            onClick={saveEdits}
                            disabled={savingEdit}
                            className="px-4 py-2 text-sm rounded-lg text-white"
                            style={{ backgroundColor: '#374151' }}
                          >
                            {savingEdit ? t('claimDetail.saving') : t('claimDetail.save')}
                          </button>
                        </div>
                      </div>
                    )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.claimType')}</label>
                      <p className="text-lg font-semibold" style={{ color: '#374151' }}>{getTypeText(claim.type)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.status')}</label>
                      <span className={`inline-block px-3 py-1 text-sm font-bold rounded-full ${getStatusColor(claim.status)}`}>
                        {getStatusText(claim.status)}
                      </span>
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.description')}</label>
                    <p className="mt-1 text-lg" style={{ color: '#374151' }}>{claim.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.incidentDate')}</label>
                      <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                        {claim.incidentDate ? new Date(claim.incidentDate).toLocaleDateString(intl, { timeZone: 'UTC' }) : t('claimDetail.notProvided')}
                      </p>
                    </div>
                    {claim.incidentTime && (
                      <div>
                        <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.incidentTime')}</label>
                        <p className="text-lg font-semibold" style={{ color: '#374151' }}>{claim.incidentTime}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {claim.estimatedAmount && (
                      <div>
                        <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.estimatedAmount')}</label>
                        <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                          {money(claim.estimatedAmount)}
                        </p>
                      </div>
                    )}
                    {claim.approvedAmount && (
                      <div>
                        <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.approvedAmountLabel')}</label>
                        <p className="text-lg font-semibold text-green-600">
                          {money(claim.approvedAmount)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer Information */}
              <div className="bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
                <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                  <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.clientInfo')}</h2>
                </div>
                <div className="p-6 space-y-4">
                    {canWrite && (
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-500">{t('claimDetail.clientEdit')}</div>
                      <button
                        data-write-action="edit-client"
                        onClick={() => setClientEditOpen(!clientEditOpen)}
                        className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {clientEditOpen ? t('claimDetail.close') : t('claimDetail.edit')}
                      </button>
                    </div>
                    )}

                    {canWrite && clientEditOpen && (
                      <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: '#e5e7eb' }}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.firstName')}</label>
                            <input className="w-full p-2 border rounded" value={clientForm.firstName} onChange={(e)=>setClientForm({...clientForm, firstName: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.lastName')}</label>
                            <input className="w-full p-2 border rounded" value={clientForm.lastName} onChange={(e)=>setClientForm({...clientForm, lastName: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.phone')}</label>
                            <input className="w-full p-2 border rounded" value={clientForm.phoneNumber} onChange={(e)=>setClientForm({...clientForm, phoneNumber: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.email')}</label>
                            <input className="w-full p-2 border rounded" value={clientForm.email} onChange={(e)=>setClientForm({...clientForm, email: e.target.value})} />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <button className="px-4 py-2 text-sm rounded-lg border border-gray-300" onClick={()=>setClientEditOpen(false)} disabled={clientSaving}>{t('claimDetail.cancel')}</button>
                          <button className="px-4 py-2 text-sm rounded-lg text-white" style={{backgroundColor:'#374151'}} onClick={saveClient} disabled={clientSaving}>{clientSaving ? t('claimDetail.saving') : t('claimDetail.save')}</button>
                        </div>
                      </div>
                    )}
                  <div>
                    <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.name')}</label>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {claim.customer.firstName && claim.customer.lastName 
                        ? `${claim.customer.firstName} ${claim.customer.lastName}`
                        : t('claimDetail.notProvided')
                      }
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.phone')}</label>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>{claim.customer.phoneNumber}</p>
                  </div>
                  {claim.customer.email && (
                    <div>
                      <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.email')}</label>
                      <p className="text-lg font-semibold" style={{ color: '#374151' }}>{claim.customer.email}</p>
                    </div>
                  )}
                  <div className="pt-4">
                    <button
                      onClick={() => router.push(`/clients/${claim.customer.id}`)}
                      className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg transition-all duration-200 hover:opacity-90"
                      style={{ 
                        background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
                      }}
                    >
                      {t('claimDetail.viewFullProfile')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Auto Claim Data (if available) */}
              {claim.autoClaimData && (
                <div className="lg:col-span-2 bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
                  <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                    <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.autoDetails')}</h2>
                  </div>
                  <div className="p-6">
                    {canWrite && (
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm text-gray-500">{t('claimDetail.autoEdit')}</div>
                      <button
                        data-write-action="edit-auto"
                        onClick={() => setAutoEditOpen(!autoEditOpen)}
                        className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {autoEditOpen ? t('claimDetail.close') : t('claimDetail.edit')}
                      </button>
                    </div>
                    )}

                    {canWrite && autoEditOpen && (
                      <div className="p-4 mb-6 rounded-lg border space-y-4" style={{ borderColor: '#e5e7eb' }}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.policyNumberShort')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.policyNumber} onChange={(e)=>setAutoForm({...autoForm, policyNumber: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.insuredName')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.insuredFullName} onChange={(e)=>setAutoForm({...autoForm, insuredFullName: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.phone')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.phoneNumber} onChange={(e)=>setAutoForm({...autoForm, phoneNumber: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.email')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.email} onChange={(e)=>setAutoForm({...autoForm, email: e.target.value})} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.address')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.address} onChange={(e)=>setAutoForm({...autoForm, address: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.birthDateEdit')}</label>
                            <input type="date" className="w-full p-2 border rounded" value={autoForm.birthDate} onChange={(e)=>setAutoForm({...autoForm, birthDate: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.license')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.licenseNumber} onChange={(e)=>setAutoForm({...autoForm, licenseNumber: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.makeModelEdit')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.vehicleMakeModel} onChange={(e)=>setAutoForm({...autoForm, vehicleMakeModel: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.year')}</label>
                            <input type="number" className="w-full p-2 border rounded" value={autoForm.vehicleYear as any} onChange={(e)=>setAutoForm({...autoForm, vehicleYear: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.registration')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.vehicleRegistration} onChange={(e)=>setAutoForm({...autoForm, vehicleRegistration: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.vin')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.vehicleVin} onChange={(e)=>setAutoForm({...autoForm, vehicleVin: e.target.value})} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.incidentLocation')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.incidentLocation} onChange={(e)=>setAutoForm({...autoForm, incidentLocation: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.roadTypeEdit')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.roadType} onChange={(e)=>setAutoForm({...autoForm, roadType: e.target.value})} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.damageDescriptionEdit')}</label>
                            <textarea rows={3} className="w-full p-2 border rounded" value={autoForm.damageDescription} onChange={(e)=>setAutoForm({...autoForm, damageDescription: e.target.value})} />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:col-span-2">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input type="checkbox" checked={autoForm.policeContacted} onChange={(e)=>setAutoForm({...autoForm, policeContacted: e.target.checked})} />
                              {t('claimDetail.policeContactedEdit')}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input type="checkbox" checked={autoForm.injuriesOccurred} onChange={(e)=>setAutoForm({...autoForm, injuriesOccurred: e.target.checked})} />
                              {t('claimDetail.injuriesOccurredEdit')}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input type="checkbox" checked={autoForm.medicalTreatmentRequired} onChange={(e)=>setAutoForm({...autoForm, medicalTreatmentRequired: e.target.checked})} />
                              {t('claimDetail.medicalTreatmentEdit')}
                            </label>
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.policeReportShort')}</label>
                            <input className="w-full p-2 border rounded" value={autoForm.policeReportNumber} onChange={(e)=>setAutoForm({...autoForm, policeReportNumber: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.estimatedCost')}</label>
                            <input type="number" className="w-full p-2 border rounded" value={autoForm.estimatedRepairCost as any} onChange={(e)=>setAutoForm({...autoForm, estimatedRepairCost: e.target.value})} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.injuryDescriptionEdit')}</label>
                            <textarea rows={2} className="w-full p-2 border rounded" value={autoForm.injuryDescription} onChange={(e)=>setAutoForm({...autoForm, injuryDescription: e.target.value})} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm text-gray-700 mb-1">{t('claimDetail.additionalNotesEdit')}</label>
                            <textarea rows={2} className="w-full p-2 border rounded" value={autoForm.additionalNotes} onChange={(e)=>setAutoForm({...autoForm, additionalNotes: e.target.value})} />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button className="px-4 py-2 text-sm rounded-lg border border-gray-300" onClick={()=>setAutoEditOpen(false)} disabled={autoSaving}>{t('claimDetail.cancel')}</button>
                          <button className="px-4 py-2 text-sm rounded-lg text-white" style={{backgroundColor:'#374151'}} onClick={saveAuto} disabled={autoSaving}>{autoSaving ? t('claimDetail.saving') : t('claimDetail.save')}</button>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {/* Policy Information */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold" style={{ color: '#374151' }}>{t('claimDetail.policyInfo')}</h3>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.policyNumber')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.policyNumber}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.insuredFullName')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.insuredFullName}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.birthDate')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>
                            {claim.autoClaimData.birthDate ? new Date(claim.autoClaimData.birthDate).toLocaleDateString(intl) : t('claimDetail.notProvided')}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.licenseNumber')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.licenseNumber}</p>
                        </div>
                      </div>

                      {/* Vehicle Information */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold" style={{ color: '#374151' }}>{t('claimDetail.vehicleInfo')}</h3>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.makeModel')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.vehicleMakeModel}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.year')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.vehicleYear}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.registration')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.vehicleRegistration}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.vin')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.vehicleVin}</p>
                        </div>
                      </div>

                      {/* Incident Information */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold" style={{ color: '#374151' }}>{t('claimDetail.incidentDetails')}</h3>
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.accidentLocation')}</label>
                          <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.incidentLocation}</p>
                        </div>
                        {claim.autoClaimData.roadType && (
                          <div>
                            <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.roadType')}</label>
                            <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.roadType}</p>
                          </div>
                        )}
                        <div>
                          <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.policeContacted')}</label>
                          <span className={`inline-block px-2 py-1 text-xs font-bold rounded-full ${
                            claim.autoClaimData.policeContacted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {claim.autoClaimData.policeContacted ? t('claimDetail.yes') : t('claimDetail.no')}
                          </span>
                        </div>
                        {claim.autoClaimData.policeReportNumber && (
                          <div>
                            <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.policeReportNumber')}</label>
                            <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.policeReportNumber}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Additional Sections */}
                    <div className="mt-8 space-y-6">
                      {/* Damage Description */}
                      <div>
                        <h3 className="text-lg font-bold mb-2" style={{ color: '#374151' }}>{t('claimDetail.damageDescription')}</h3>
                        <p className="p-4 rounded-lg" style={{ backgroundColor: '#f9fafb', color: '#374151' }}>
                          {claim.autoClaimData.damageDescription}
                        </p>
                      </div>

                      {/* Other Party Information */}
                      {claim.autoClaimData.otherDriverName && (
                        <div>
                          <h3 className="text-lg font-bold mb-4" style={{ color: '#374151' }}>{t('claimDetail.otherParty')}</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.otherDriverName')}</label>
                              <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.otherDriverName}</p>
                            </div>
                            {claim.autoClaimData.otherDriverPhone && (
                              <div>
                                <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.phone')}</label>
                                <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.otherDriverPhone}</p>
                              </div>
                            )}
                            {claim.autoClaimData.otherInsuranceCompany && (
                              <div>
                                <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.insuranceCompany')}</label>
                                <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.otherInsuranceCompany}</p>
                              </div>
                            )}
                            {claim.autoClaimData.otherVehicleRegistration && (
                              <div>
                                <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.otherVehicleRegistration')}</label>
                                <p className="font-semibold" style={{ color: '#374151' }}>{claim.autoClaimData.otherVehicleRegistration}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Injuries */}
                      <div>
                        <h3 className="text-lg font-bold mb-2" style={{ color: '#374151' }}>{t('claimDetail.injuries')}</h3>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.injuriesOccurred')}</label>
                            <span className={`inline-block px-2 py-1 text-xs font-bold rounded-full ${
                              claim.autoClaimData.injuriesOccurred ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {claim.autoClaimData.injuriesOccurred ? t('claimDetail.yes') : t('claimDetail.no')}
                            </span>
                          </div>
                          <div>
                            <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.medicalTreatment')}</label>
                            <span className={`inline-block px-2 py-1 text-xs font-bold rounded-full ${
                              claim.autoClaimData.medicalTreatmentRequired ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {claim.autoClaimData.medicalTreatmentRequired ? t('claimDetail.yes') : t('claimDetail.no')}
                            </span>
                          </div>
                        </div>
                        {claim.autoClaimData.injuryDescription && (
                          <div>
                            <label className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('claimDetail.injuryDescription')}</label>
                            <p className="p-4 rounded-lg" style={{ backgroundColor: '#f9fafb', color: '#374151' }}>
                              {claim.autoClaimData.injuryDescription}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Additional Notes */}
                      {claim.autoClaimData.additionalNotes && (
                        <div>
                          <h3 className="text-lg font-bold mb-2" style={{ color: '#374151' }}>{t('claimDetail.additionalNotes')}</h3>
                          <p className="p-4 rounded-lg" style={{ backgroundColor: '#f9fafb', color: '#374151' }}>
                            {claim.autoClaimData.additionalNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
              <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div>
                    <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.documentsAndPhotos')}</h2>
                    <p className="mt-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2 max-w-2xl">
                      {t('claimDetail.missingInfoWarning')}
                    </p>
                  </div>
                  {canWrite && (
                  <div data-write-action="upload-documents" className="flex items-center space-x-4 rtl:space-x-reverse">
                    <input
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                      className="hidden"
                      id="file-upload"
                      disabled={uploadingFile}
                    />
                    <label
                      htmlFor="file-upload"
                      className={`px-4 py-2 rounded-lg font-medium text-white cursor-pointer transition-all ${
                        uploadingFile ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                      }`}
                      style={{ backgroundColor: '#374151' }}
                    >
                      {uploadingFile ? t('claimDetail.uploading') : t('claimDetail.addFiles')}
                    </label>
                  </div>
                  )}
                </div>
              </div>
              <div className="p-6">
                {/* Damage Photos Section */}
                {(() => {
                  // Support both legacy (DamagePhotos) and schema (damagePhotos) casing
                  const photos = claim.autoClaimData
                    ? (Array.isArray((claim.autoClaimData as any).DamagePhotos)
                        ? (claim.autoClaimData as any).DamagePhotos
                        : Array.isArray((claim.autoClaimData as any).damagePhotos)
                          ? (claim.autoClaimData as any).damagePhotos
                          : [])
                    : [];
                  return photos.length > 0 ? (
                  <div className="mb-8">
                    <h3 className="text-xl font-bold mb-4" style={{ color: '#374151' }}>{t('claimDetail.damagePhotos')}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                      {photos.map((photoUrl: string, idx: number) => (
                        <div key={idx} className="border rounded-lg p-2 flex flex-col items-center" style={{ borderColor: '#e5e7eb' }}>
                          <AuthedImage
                            src={String(photoUrl)}
                            alt={t('claimDetail.photoAlt', { n: idx + 1 })}
                            className="object-cover rounded-lg mb-2"
                            style={{ width: '100%', maxHeight: '220px', background: '#f9fafb' }}
                          />
                          <span className="text-xs text-gray-500">{t('claimDetail.photoN', { n: idx + 1 })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  ) : null;
                })()}
                {/* Drag and Drop Area */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 mb-6 text-center transition-colors ${
                    dragActive
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <div className="flex flex-col items-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-lg font-medium text-gray-900 mb-2">
                      {t('claimDetail.dropFiles')}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t('claimDetail.acceptedFiles')}
                    </p>
                  </div>
                </div>

                {/* Document Preview Section */}
                {claim.documents.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-4" style={{ color: '#374151' }}>
                      {t('claimDetail.documentsPreviews')}
                    </h3>
                    
                    {/* Document Categories Summary */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2 rtl:space-x-reverse">
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-sm font-medium text-blue-800">
                            {t('claimDetail.pdfCount', { count: claim.documents.filter(d => d.fileType === 'application/pdf').length })}
                          </span>
                        </div>
                      </div>
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2 rtl:space-x-reverse">
                          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium text-green-800">
                            {t('claimDetail.imageCount', { count: claim.documents.filter(d => {
                              const ft = (d.fileType || '').toLowerCase();
                              if (ft.startsWith('image/')) return true;
                              const ext = d.fileName?.split('.').pop()?.toLowerCase();
                              return ['jpg','jpeg','png','gif','webp','bmp','heic','heif'].includes(ext || '');
                            }).length })}
                          </span>
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2 rtl:space-x-reverse">
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium text-gray-800">
                            {t('claimDetail.otherCount', { count: claim.documents.filter(d => {
                              const ft = (d.fileType || '').toLowerCase();
                              const ext = d.fileName?.split('.').pop()?.toLowerCase();
                              const isImg = ft.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','heic','heif'].includes(ext || '');
                              const isPdf = ft === 'application/pdf' || ext === 'pdf';
                              return !isImg && !isPdf;
                            }).length })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Document List */}
                      <div>
                        <h4 className="text-md font-medium mb-3" style={{ color: '#6b7280' }}>
                          {t('claimDetail.allDocuments', { count: claim.documents.length })}
                        </h4>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {claim.documents.map((document, index) => {
                            const ft = (document.fileType || '').toLowerCase();
                            const ext = document.fileName?.split('.').pop()?.toLowerCase();
                            const isImage = ft.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','heic','heif'].includes(ext || '');
                            const isPDF = ft === 'application/pdf' || ext === 'pdf';
                            const isSelected = selectedDocumentIndex === index;
                            
                            return (
                              <div 
                                key={document.id}
                                className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                                  isSelected 
                                    ? 'border-blue-400 bg-blue-50' 
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                                onClick={() => setSelectedDocumentIndex(index)}
                              >
                                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                                  <div className={`w-8 h-8 rounded flex items-center justify-center ${
                                    isPDF ? 'bg-red-500' : isImage ? 'bg-green-500' : 'bg-gray-500'
                                  }`} style={{ 
                                    backgroundColor: isSelected ? '#3b82f6' : (isPDF ? '#dc2626' : isImage ? '#16a34a' : '#6b7280')
                                  }}>
                                    {isImage ? (
                                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    ) : isPDF ? (
                                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate" style={{ 
                                      color: isSelected ? '#1f2937' : '#374151' 
                                    }}>
                                      {document.fileName}
                                      {isPDF && <span className="ms-1 text-xs text-red-600 font-semibold">PDF</span>}
                                      {isImage && <span className="ms-1 text-xs text-green-600 font-semibold">IMG</span>}
                                    </p>
                                    <p className="text-xs" style={{ color: '#6b7280' }}>
                                      {formatFileSize(document.fileSize)} • {new Date(document.createdAt).toLocaleDateString(intl)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Document Preview */}
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="text-md font-medium" style={{ color: '#6b7280' }}>
                            {t('claimDetail.documentPreview')}
                          </h4>
                          {selectedDocumentIndex !== null && claim.documents[selectedDocumentIndex] && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openDoc(claim.documents[selectedDocumentIndex])}
                                className="px-3 py-1 text-sm font-medium text-white rounded-lg transition-all duration-200 hover:opacity-90"
                                style={{ 
                                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                                }}
                              >
                                {t('claimDetail.open')}
                              </button>
                              <button
                                onClick={() => downloadDoc(claim.documents[selectedDocumentIndex])}
                                className="px-3 py-1 text-sm font-medium text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 transition-all duration-200"
                              >
                                {t('claimDetail.download')}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="border rounded-lg" style={{ height: '400px', borderColor: '#e5e7eb' }}>
                          {selectedDocumentIndex !== null && claim.documents[selectedDocumentIndex] ? (
                            (() => {
                              const doc = claim.documents[selectedDocumentIndex];
                              const ft = (doc.fileType || '').toLowerCase();
                              const ext = doc.fileName?.split('.').pop()?.toLowerCase();
                              const isImg = ft.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','heic','heif'].includes(ext || '');
                              const isPdf = ft === 'application/pdf' || ext === 'pdf';
                              if (isImg) {
                                return (
                                  <div className="w-full h-full flex items-center justify-center bg-white rounded-lg">
                                    <AuthedImage
                                      src={docUrl(doc)}
                                      alt={doc.fileName}
                                      className="max-w-full max-h-full object-contain"
                                      style={{ width: '100%', height: '100%' }}
                                    />
                                  </div>
                                );
                              }
                              if (isPdf) {
                                return (
                                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 rounded-lg border border-red-100">
                                    <div className="text-center p-8">
                                      <div className="w-24 h-24 mx-auto mb-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                                        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                        </svg>
                                      </div>
                                      <h3 className="text-xl font-bold text-gray-900 mb-2">{t('claimDetail.pdfDocument')}</h3>
                                      <p className="text-sm text-gray-600 mb-2">{doc.fileName}</p>
                                      <p className="text-xs text-gray-500 mb-6">{t('claimDetail.docMeta', { size: formatFileSize(doc.fileSize), date: new Date(doc.createdAt).toLocaleDateString(intl) })}</p>
                                      <div className="space-y-3 max-w-sm mx-auto">
                                        <button
                                          onClick={() => openDoc(doc)}
                                          className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 flex items-center justify-center space-x-3 rtl:space-x-reverse font-medium shadow-lg hover:shadow-xl transform hover:scale-105"
                                        >
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                          <span>{t('claimDetail.viewInBrowser')}</span>
                                        </button>
                                        <button
                                          onClick={() => downloadDoc(doc)}
                                          className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:from-green-600 hover:to-green-700 transition-all duration-200 flex items-center justify-center space-x-3 rtl:space-x-reverse font-medium shadow-lg hover:shadow-xl transform hover:scale-105"
                                        >
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                          </svg>
                                          <span>{t('claimDetail.download')}</span>
                                        </button>
                                      </div>
                                      <p className="text-xs text-gray-400 mt-6">{t('claimDetail.previewTip')}</p>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 rounded-lg p-8">
                                  <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  <p className="text-gray-500 text-center mb-4">{t('claimDetail.previewUnavailable')}</p>
                                  <div className="flex gap-3">
                                    <button onClick={() => openDoc(doc)} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">{t('claimDetail.viewInBrowser')}</button>
                                    <button onClick={() => downloadDoc(doc)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors">{t('claimDetail.download')}</button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 rounded-lg">
                              <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              <p className="text-gray-500">{t('claimDetail.selectDocument')}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'progression' && (
            <div className="bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
              <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.progressTitle')}</h2>
              </div>
              <div className="p-6">
                {/* Status Update and Message Actions (hidden from read-only roles) */}
                {canWrite && (
                <div data-write-action="status-and-message" className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  {/* Status Update Section */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4" style={{ color: '#374151' }}>{t('claimDetail.changeStatus')}</h3>
                    <div className="space-y-4">
                      <select
                        value={updateStatus}
                        onChange={(e) => setUpdateStatus(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-700"
                        disabled={isUpdatingStatus}
                      >
                        <option value="">{t('claimDetail.selectNewStatus')}</option>
                        {CLAIM_STATUSES.map((s) => (
                          <option key={s} value={s}>{getStatusText(s)}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleStatusUpdate}
                        disabled={!updateStatus || isUpdatingStatus}
                        className="w-full px-6 py-3 bg-gray-700 text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isUpdatingStatus ? t('claimDetail.updating') : t('claimDetail.update')}
                      </button>
                    </div>
                  </div>

                  {/* Direct Message Section */}
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4" style={{ color: '#374151' }}>{t('claimDetail.sendDirectMessage')}</h3>
                    <div className="space-y-4">
                      <textarea
                        value={directMessageText}
                        onChange={(e) => setDirectMessageText(e.target.value)}
                        placeholder={t('claimDetail.messagePlaceholder')}
                        className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-700"
                        rows={4}
                        disabled={isSendingMessage}
                      />
                      
                      {/* Quick Message Templates */}
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-2" style={{ color: '#6b7280' }}>{t('claimDetail.quickMessages')}</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            t('claimDetail.quick1', { claimNumber: claim.claimNumber }),
                            t('claimDetail.quick2', { claimNumber: claim.claimNumber }),
                            t('claimDetail.quick3', { claimNumber: claim.claimNumber }),
                            t('claimDetail.quick4', { claimNumber: claim.claimNumber }),
                          ].map((template, index) => (
                            <button
                              key={index}
                              onClick={() => setDirectMessageText(template)}
                              className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded-full text-blue-700 transition-colors"
                              disabled={isSendingMessage}
                            >
                              {template.length > 40 ? template.substring(0, 40) + '...' : template}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex justify-end space-x-2 rtl:space-x-reverse">
                        <button
                          onClick={() => setDirectMessageText('')}
                          disabled={!directMessageText.trim() || isSendingMessage}
                          className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {t('claimDetail.clear')}
                        </button>
                        <button
                          onClick={handleSendMessage}
                          disabled={!directMessageText.trim() || isSendingMessage}
                          className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isSendingMessage ? t('claimDetail.sending') : t('claimDetail.send')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Current Status */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold mb-4" style={{ color: '#374151' }}>{t('claimDetail.currentStatus')}</h3>
                  <div className="flex items-center justify-between p-4 rounded-lg" style={{ backgroundColor: '#f9fafb' }}>
                    <div className="flex items-center space-x-4 rtl:space-x-reverse">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#374151' }}>
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-2xl font-bold" style={{ color: '#374151' }}>#{claim.claimNumber}</p>
                        <span className={`px-4 py-2 text-lg font-bold rounded-full ${getStatusColor(claim.status)}`}>
                          {getStatusText(claim.status)}
                        </span>
                      </div>
                    </div>
                    <div className="text-end">
                      <p className="text-sm text-gray-500">{t('claimDetail.lastUpdate')}</p>
                      <p className="text-lg font-medium" style={{ color: '#374151' }}>
                        {new Date(claim.updatedAt).toLocaleString(intl)}
                      </p>
                    </div>
                  </div>
                </div>



                {/* Progress Timeline */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold mb-6" style={{ color: '#374151' }}>{t('claimDetail.timeline')}</h3>
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute start-8 top-0 bottom-0 w-0.5" style={{ backgroundColor: '#d1d5db' }}></div>
                    
                    {/* Timeline steps */}
                    <div className="space-y-8">
                      {[
                        {
                          status: 'NEW',
                          title: t('claimDetail.stepNewTitle'),
                          date: claim.createdAt,
                          completed: true,
                          description: t('claimDetail.stepNewDesc')
                        },
                        {
                          status: 'ONGOING',
                          title: t('claimDetail.stepOngoingTitle'),
                          date: claim.status !== 'NEW' ? claim.updatedAt : null,
                          completed: ['ONGOING', 'APPROVED', 'REJECTED', 'COMPLETED'].includes(claim.status),
                          description: t('claimDetail.stepOngoingDesc')
                        },
                        {
                          status: 'APPROVED',
                          title: t('claimDetail.stepApprovedTitle'),
                          date: claim.approvedAt,
                          completed: claim.status === 'APPROVED' || claim.status === 'COMPLETED',
                          description: t('claimDetail.stepApprovedDesc')
                        },
                        {
                          status: 'COMPLETED',
                          title: t('claimDetail.stepCompletedTitle'),
                          date: claim.completedAt,
                          completed: claim.status === 'COMPLETED',
                          description: t('claimDetail.stepCompletedDesc')
                        }
                      ].map((step) => (
                        <div key={step.status} className="relative flex items-start">
                          <div 
                            className={`w-16 h-16 rounded-full flex items-center justify-center z-10 ${
                              step.completed
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-200 text-gray-500'
                            }`}
                          >
                            {step.completed ? (
                              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-current"></div>
                            )}
                          </div>
                          <div className="ms-6 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className={`text-lg font-bold ${
                                step.completed ? 'text-green-600' : 'text-gray-500'
                              }`}>
                                {step.title}
                              </h4>
                              {step.date && (
                                <span className="text-sm text-gray-500">
                                  {new Date(step.date).toLocaleString(intl)}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {step.description}
                            </p>
                            {step.status === 'APPROVED' && claim.approvedAmount && (
                              <div className="mt-2">
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                                  {t('claimDetail.approvedAmount', { amount: money(claim.approvedAmount) })}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      
                      {/* Rejected status if applicable */}
                      {claim.status === 'REJECTED' && (
                        <div className="relative flex items-start">
                          <div className="w-16 h-16 rounded-full flex items-center justify-center z-10 bg-red-500 text-white">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                          <div className="ms-6 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="text-lg font-bold text-red-600">{t('claimDetail.claimRejected')}</h4>
                              {claim.rejectedAt && (
                                <span className="text-sm text-gray-500">
                                  {new Date(claim.rejectedAt).toLocaleString(intl)}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {t('claimDetail.claimRejectedDesc')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 rounded-lg" style={{ backgroundColor: '#f0f9ff' }}>
                    <div className="flex items-center">
                      <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="ms-4">
                        <p className="text-sm text-blue-600 font-medium">{t('claimDetail.elapsed')}</p>
                        <p className="text-lg font-bold text-blue-900">
                          {t('claimDetail.days', { count: Math.ceil((new Date().getTime() - new Date(claim.createdAt).getTime()) / (1000 * 60 * 60 * 24)) })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg" style={{ backgroundColor: '#f0fdf4' }}>
                    <div className="flex items-center">
                      <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="ms-4">
                        <p className="text-sm text-green-600 font-medium">{t('claimDetail.documents')}</p>
                        <p className="text-lg font-bold text-green-900">
                          {t('claimDetail.fileCount', { count: claim.documents.length })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg" style={{ backgroundColor: '#fefce8' }}>
                    <div className="flex items-center">
                      <div className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <div className="ms-4">
                        <p className="text-sm text-yellow-600 font-medium">{t('claimDetail.notes')}</p>
                        <p className="text-lg font-bold text-yellow-900">
                          {t('claimDetail.noteCount', { count: claim.claimNotes.length })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="bg-white shadow-2xl rounded-2xl border" style={{ borderColor: '#6b7280' }}>
              <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>{t('claimDetail.notesAndComments')}</h2>
              </div>
              <div className="p-6">
                {/* Add Note Form (hidden from read-only roles) */}
                {canWrite && (
                <div data-write-action="add-note" className="mb-6 p-4 rounded-xl border" style={{ borderColor: '#e5e7eb' }}>
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t('claimDetail.addNotePlaceholder')}
                    className="w-full p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-700"
                    style={{ borderColor: '#d1d5db' }}
                    rows={3}
                  />
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={handleAddNote}
                      disabled={!newNote.trim() || isAddingNote}
                      className="px-4 py-2 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#374151' }}
                    >
                      {isAddingNote ? t('claimDetail.adding') : t('claimDetail.addNote')}
                    </button>
                  </div>
                </div>
                )}

                {/* Notes List */}
                {claim.claimNotes.length > 0 ? (
                  <div className="space-y-4">
                    {claim.claimNotes.map((note) => (
                      <div key={note.id} className="p-4 rounded-xl" style={{ backgroundColor: '#f9fafb' }}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2 rtl:space-x-reverse">
                            <div 
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                              style={{ backgroundColor: '#374151' }}
                            >
                              {note.author.firstName.charAt(0)}{note.author.lastName.charAt(0)}
                            </div>
                            <div>
                              <p className="font-medium text-sm" style={{ color: '#374151' }}>
                                {note.author.firstName} {note.author.lastName}
                              </p>
                              <p className="text-xs" style={{ color: '#6b7280' }}>
                                {new Date(note.createdAt).toLocaleString(intl)}
                              </p>
                            </div>
                          </div>
                          {note.isInternal && (
                            <span className="px-2 py-1 text-xs font-bold rounded-full bg-yellow-100 text-yellow-800">
                              {t('claimDetail.internal')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm" style={{ color: '#374151' }}>
                          {note.content}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-16 w-16 mb-4" style={{ color: '#d1d5db' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-lg font-medium" style={{ color: '#6b7280' }}>
                      {t('claimDetail.noNotes')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}


          <div className="mt-12 flex justify-center space-x-4 rtl:space-x-reverse">
            <button
              onClick={() => router.push('/claims')}
              className="text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse"
              style={{ backgroundColor: '#374151' }}
            >
              <svg className="w-6 h-6 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>{t('claimDetail.backToClaims')}</span>
            </button>
            
            {claim.customer && (
              <button
                onClick={() => router.push(`/clients/${claim.customer.id}`)}
                className="border-2 px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse"
                style={{ 
                  borderColor: '#6b7280', 
                  color: '#374151',
                  backgroundColor: 'white'
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>{t('claimDetail.viewClient')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Utility functions
// Removed duplicate helper functions (getStatusColor, getStatusText, getTypeText, formatFileSize)
