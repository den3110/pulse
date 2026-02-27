import sshService from "./sshService";
import logger from "../utils/logger";
import { logActivity } from "./activityLogger";

class SslService {
  /**
   * Ensure certbot is installed on the target server.
   */
  async ensureCertbotInstalled(serverId: string): Promise<void> {
    try {
      // Check if certbot is present
      const checkResult = await sshService.exec(
        serverId,
        "which certbot || echo 'NOT_FOUND'",
      );

      if (checkResult.stdout.includes("NOT_FOUND")) {
        logger.info(
          `[SSL] Certbot not found on server ${serverId}. Installing...`,
        );
        // Basic install for Ubuntu/Debian
        const installResult = await sshService.exec(
          serverId,
          "apt-get update && apt-get install -y certbot python3-certbot-nginx",
        );
        if (installResult.code !== 0) {
          throw new Error("Failed to install certbot: " + installResult.stderr);
        }
        logger.info(`[SSL] Certbot successfully installed on ${serverId}`);
      }
    } catch (error: any) {
      throw new Error(`Error verifying/installing certbot: ${error.message}`);
    }
  }

  /**
   * Provision a Let's Encrypt SSL certificate using certbot --nginx.
   */
  async provisionSsl(
    serverId: string,
    domain: string,
    email: string,
    userId: string,
    teamId?: string,
  ): Promise<{ success: boolean; message: string; output: string }> {
    try {
      if (!domain || !email) {
        throw new Error("Domain and Email are required to provision SSL");
      }

      await this.ensureCertbotInstalled(serverId);

      // Run certbot in non-interactive mode.
      // --agree-tos: Agree to the ACME Server's Subscriber Agreement
      // --nginx: Use the Nginx plugin to automatically modify blocks
      // -d: Domain
      // -m: Email for expiration notices
      const cmd = `certbot --nginx --non-interactive --agree-tos -m ${email} -d ${domain}`;

      logger.info(
        `[SSL] Running certbot for domain ${domain} on server ${serverId}`,
      );
      const result = await sshService.exec(serverId, cmd);

      const success = result.code === 0;
      const message = success
        ? `Successfully provisioned SSL for ${domain}`
        : `Failed to provision SSL: ${result.stderr}`;

      logActivity({
        action: success ? "ssl.provision" : "ssl.provision_failed",
        userId,
        team: teamId,
        details: `${success ? "Provisioned" : "Failed to provision"} SSL for ${domain} on server ${serverId} using email ${email}`,
        ip: "system", // Service level execution
      });

      return {
        success,
        message,
        output: result.stdout || result.stderr,
      };
    } catch (error: any) {
      logger.error(`[SSL] Exception provisioning SSL: ${error.message}`);
      return {
        success: false,
        message: error.message,
        output: error.stack,
      };
    }
  }

  /**
   * List expiry dates of certificates currently managed by certbot.
   */
  async listCertificates(serverId: string): Promise<string> {
    try {
      await this.ensureCertbotInstalled(serverId);
      const result = await sshService.exec(serverId, "certbot certificates");
      return result.stdout || result.stderr;
    } catch (error: any) {
      return `Failed to list certificates: ${error.message}`;
    }
  }
}

export default new SslService();
