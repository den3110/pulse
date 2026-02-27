import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
import Settings from "../models/Settings";
import logger from "../utils/logger";

class S3StorageService {
  private async getS3Client(): Promise<{
    client: S3Client;
    bucketName: string;
  } | null> {
    const settings = await Settings.findOne();
    if (!settings || !settings.s3Storage || !settings.s3Storage.enabled) {
      return null;
    }

    const { accessKeyId, secretAccessKey, endpoint, region, bucketName } =
      settings.s3Storage;

    if (!accessKeyId || !secretAccessKey || !bucketName) {
      logger.warn("[S3] Storage is enabled but missing credentials/bucket.");
      return null;
    }

    const client = new S3Client({
      region: region || "auto", // Works for R2 and Spaces
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      // Optional flag for S3 API compatibilities like MinIO/R2
      forcePathStyle: endpoint ? true : false,
    });

    return { client, bucketName };
  }

  /**
   * Uploads a local file to the configured S3 bucket.
   * @param localFilePath Absolute path to the local file
   * @param s3Key The desired path/filename in the remote bucket
   * @returns true if upload is successful, false otherwise
   */
  async uploadFile(localFilePath: string, s3Key: string): Promise<boolean> {
    try {
      const s3Config = await this.getS3Client();
      if (!s3Config) {
        logger.info("[S3] Upload skipped (S3 not configured or disabled).");
        return false;
      }

      const { client, bucketName } = s3Config;

      if (!fs.existsSync(localFilePath)) {
        throw new Error(`Local file not found: ${localFilePath}`);
      }

      const fileStream = fs.createReadStream(localFilePath);
      const fileSize = fs.statSync(localFilePath).size;

      logger.info(
        `[S3] Uploading ${s3Key} (${(fileSize / 1024 / 1024).toFixed(2)} MB) to bucket ${bucketName}...`,
      );

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileStream,
      });

      await client.send(command);
      logger.info(`[S3] Upload completed successfully: ${s3Key}`);
      return true;
    } catch (error: any) {
      logger.error(`[S3] Upload failed for ${s3Key}: ${error.message}`);
      return false;
    }
  }
}

export default new S3StorageService();
