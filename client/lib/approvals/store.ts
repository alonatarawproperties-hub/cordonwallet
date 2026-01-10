import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApprovalRecord, ApprovalStatus, generateApprovalId } from "./types";

const STORAGE_PREFIX = "@cordon/approvals";

function getStorageKey(owner: `0x${string}`, chainId: number): string {
  return `${STORAGE_PREFIX}/${owner.toLowerCase()}/${chainId}`;
}

export async function saveApproval(record: ApprovalRecord): Promise<void> {
  const key = getStorageKey(record.owner, record.chainId);
  const existing = await listApprovals({ owner: record.owner, chainId: record.chainId });
  
  const existingIndex = existing.findIndex(r => r.id === record.id);
  if (existingIndex >= 0) {
    existing[existingIndex] = record;
  } else {
    existing.unshift(record);
  }
  
  await AsyncStorage.setItem(key, JSON.stringify(existing));
}

export async function listApprovals(params: {
  owner: `0x${string}`;
  chainId?: number;
}): Promise<ApprovalRecord[]> {
  const { owner, chainId } = params;
  
  if (chainId !== undefined) {
    const key = getStorageKey(owner, chainId);
    const data = await AsyncStorage.getItem(key);
    if (!data) return [];
    try {
      return JSON.parse(data) as ApprovalRecord[];
    } catch {
      return [];
    }
  }
  
  const allKeys = await AsyncStorage.getAllKeys();
  const approvalKeys = allKeys.filter(k => 
    k.startsWith(`${STORAGE_PREFIX}/${owner.toLowerCase()}/`)
  );
  
  if (approvalKeys.length === 0) return [];
  
  const results = await AsyncStorage.multiGet(approvalKeys);
  const approvals: ApprovalRecord[] = [];
  
  for (const [, value] of results) {
    if (value) {
      try {
        const records = JSON.parse(value) as ApprovalRecord[];
        approvals.push(...records);
      } catch {
        continue;
      }
    }
  }
  
  return approvals.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateApprovalStatus(
  owner: `0x${string}`,
  chainId: number,
  txHash: `0x${string}`,
  status: ApprovalStatus,
  updates?: Partial<ApprovalRecord>
): Promise<void> {
  const approvals = await listApprovals({ owner, chainId });
  const index = approvals.findIndex(a => a.txHash === txHash);
  
  if (index >= 0) {
    approvals[index] = {
      ...approvals[index],
      ...updates,
      status,
      lastCheckedAt: Date.now(),
    };
    const key = getStorageKey(owner, chainId);
    await AsyncStorage.setItem(key, JSON.stringify(approvals));
  }
}

export async function updateApprovalById(
  id: string,
  updates: Partial<ApprovalRecord>
): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const approvalKeys = allKeys.filter(k => k.startsWith(STORAGE_PREFIX));
  
  for (const key of approvalKeys) {
    const data = await AsyncStorage.getItem(key);
    if (!data) continue;
    
    try {
      const records = JSON.parse(data) as ApprovalRecord[];
      const index = records.findIndex(r => r.id === id);
      
      if (index >= 0) {
        records[index] = { ...records[index], ...updates };
        await AsyncStorage.setItem(key, JSON.stringify(records));
        return;
      }
    } catch {
      continue;
    }
  }
}

export async function removeApproval(id: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const approvalKeys = allKeys.filter(k => k.startsWith(STORAGE_PREFIX));
  
  for (const key of approvalKeys) {
    const data = await AsyncStorage.getItem(key);
    if (!data) continue;
    
    try {
      const records = JSON.parse(data) as ApprovalRecord[];
      const filtered = records.filter(r => r.id !== id);
      
      if (filtered.length !== records.length) {
        await AsyncStorage.setItem(key, JSON.stringify(filtered));
        return;
      }
    } catch {
      continue;
    }
  }
}

export async function upsertApproval(record: ApprovalRecord): Promise<void> {
  const existingApprovals = await listApprovals({ 
    owner: record.owner, 
    chainId: record.chainId 
  });
  
  const existingIndex = existingApprovals.findIndex(a => a.id === record.id);
  
  if (existingIndex >= 0) {
    existingApprovals[existingIndex] = {
      ...existingApprovals[existingIndex],
      ...record,
      lastCheckedAt: Date.now(),
    };
  } else {
    existingApprovals.unshift(record);
  }
  
  const key = getStorageKey(record.owner, record.chainId);
  await AsyncStorage.setItem(key, JSON.stringify(existingApprovals));
}

export async function getApprovalById(id: string): Promise<ApprovalRecord | null> {
  const allKeys = await AsyncStorage.getAllKeys();
  const approvalKeys = allKeys.filter(k => k.startsWith(STORAGE_PREFIX));
  
  for (const key of approvalKeys) {
    const data = await AsyncStorage.getItem(key);
    if (!data) continue;
    
    try {
      const records = JSON.parse(data) as ApprovalRecord[];
      const found = records.find(r => r.id === id);
      if (found) return found;
    } catch {
      continue;
    }
  }
  
  return null;
}
