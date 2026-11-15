import { join } from 'node:path';
import { AppError } from '../../shared/errors';
import { EncryptedBackup } from '../decrypt/backup';
import { CHAT_DB_PATH, CHAT_DOMAIN, ChatStorage } from './chatstorage';
import type { ChatSource } from './pipeline';

/** ADR section 5 pipeline steps 1 to 4: unlock, decrypt the manifest, find and open the chat database. */
export async function openBackupSource(
  backupDir: string,
  password: string,
  tmpDir: string,
): Promise<ChatSource & { close(): void }> {
  const backup = await EncryptedBackup.open(backupDir, password, tmpDir);
  let storage: ChatStorage;
  try {
    const dbPath = join(tmpDir, CHAT_DB_PATH);
    if (!(await backup.extract(CHAT_DOMAIN, CHAT_DB_PATH, dbPath))) {
      throw new AppError('UNSUPPORTED_DATA', 'Chat database not found in backup');
    }
    storage = new ChatStorage(dbPath);
  } catch (e) {
    backup.close();
    throw e;
  }
  return {
    chats: () => storage.chats(),
    copyMedia: (localPath, dest) => backup.extract(CHAT_DOMAIN, localPath, dest),
    close: () => {
      storage.close();
      backup.close();
    },
  };
}
