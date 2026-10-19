# Deploying KBH to Render

## Deploy

1. Push this project to a GitHub repository. The `node_modules` folder should not be committed.
2. Sign in to Render and choose **New + > Blueprint**.
3. Connect the repository and deploy the `render.yaml` Blueprint.
4. Wait for the service status to become **Live**. Render will provide a public address such as `https://kbh-quiz.onrender.com`.
5. Open that address on the host device. Players open the same address followed by `/player`, for example `https://kbh-quiz.onrender.com/player`.
6. Use the same room ID on the host and all players. Both pages connect to the deployed service automatically, including its secure WebSocket connection.

The host and players do not need to be on the same Wi-Fi or local network. Each device does need an internet connection; mobile data works. The code editor and your computer's terminal can be closed after deployment.

## Free service notes

The free Render service may spin down after inactivity and take a little time to wake when someone opens it. For a game session, open the host page first and wait until it reports that the server is connected. An always-on service requires a paid Render plan.

Without the Supabase variables, uploaded images, audio, video, and score data use the service's local filesystem. Render's free filesystem is temporary, so local-mode files can be lost when the service restarts or is redeployed. Scores still use the local JSON file; only media uploads and their library indexes are moved to Supabase by the configuration below.

## Free persistent media storage with Supabase

The app supports Supabase Storage for uploaded images, videos, and audio. Create a free Supabase project and create three **public** Storage buckets named exactly:

- `images`
- `videos`
- `audio`

Add these Environment Variables to the Render service:

```text
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The service-role key must stay only in Render's server environment variables; never put it in `host.html` or `Player.html`. With both variables set, new uploads and their library indexes are stored in Supabase. Existing files in Render's temporary folders must be uploaded again after this setup.
