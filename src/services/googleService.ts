import axios from "axios";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export interface GoogleProfile {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
}

class GoogleService {
  /**
   * Exchange authorization code for an access token
   * @param code The authorization code from the frontend
   * @param redirectUri The callback URL configured in Google Console
   * @returns The access token
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<string> {
    try {
      const response = await axios.post(
        GOOGLE_TOKEN_URL,
        {
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      return response.data.access_token;
    } catch (error: any) {
      console.error(
        "Google Token Exchange Error:",
        error.response?.data || error.message,
      );
      const errorDetail =
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message;
      throw new Error(`Google API: ${errorDetail}`);
    }
  }

  /**
   * Fetch user profile information using the access token
   * @param accessToken The access token
   * @returns Google Profile object
   */
  async getUserProfile(accessToken: string): Promise<GoogleProfile> {
    try {
      const response = await axios.get<GoogleProfile>(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error(
        "Google User Info Error:",
        error.response?.data || error.message,
      );
      throw new Error("Failed to fetch Google user profile");
    }
  }
}

export default new GoogleService();
