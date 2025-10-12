# Manual Regression Tests

## Continuous location sharing preserves chat messaging
1. Join or create a room.
2. Send a regular text message to confirm the chat controls are active.
3. Open the quick actions menu and choose **位置共有を開始** to start continuous location sharing.
4. When the browser prompts for permission, allow location access. Wait for the confirmation message that continuous sharing started.
5. Verify that the chat input and **送信** button remain enabled. Type a new message and click **送信** (or press Enter) while continuous sharing continues.
6. Confirm the message is delivered to the room and that the live map updates to show your current position.
7. Click **位置共有を停止** to stop sharing.

## One-time location share updates the live map
1. Join a room with the app open in two browser windows if possible.
2. Click **位置を1回共有** and allow location access.
3. Confirm that a location message appears in the transcript and the live map marker moves to the shared coordinates.
4. In the second window, observe that the map marker also updates without needing to refresh the page.
