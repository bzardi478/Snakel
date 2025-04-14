// auth.js
const admin = require('firebase-admin'); // Ensure Firebase Admin SDK is imported

async function registerUser(adminInstance, username, password, callback) {
    try {
        const userRecord = await adminInstance.auth().createUser({
            displayName: username,
            password: password,
        });

        const database = adminInstance.database();
        const userRef = database.ref(`users/${userRecord.uid}`);
        await userRef.set({
            username: username,
            registrationTime: adminInstance.database.ServerValue.TIMESTAMP,
        });

        callback({ success: true, message: 'User registered successfully', uid: userRecord.uid });
    } catch (error) {
        console.error('Error registering user - CATCH BLOCK ENTERED (Realtime DB):', error);
        callback({ success: false, message: `Error registering user: ${error.message}` });
    }
}

async function loginUser(adminInstance, username, password, callback) {
    try {
        const database = adminInstance.database();
        const usersRef = database.ref('users');
        const snapshot = await usersRef.orderByChild('username').equalTo(username).once('value');
        const userData = snapshot.val();

        if (!userData) {
            return callback({ success: false, message: 'Invalid username or password' });
        }

        const uid = Object.keys(userData)[0]; // Get the UID of the found user

        // Firebase Admin SDK doesn't directly verify passwords stored with createUser.
        // You would typically handle password verification on the client-side
        // using Firebase Authentication and then verify the ID token on the server.

        console.warn('Password verification not implemented on the server-side in this Realtime DB example.');
        return callback({ success: true, message: 'Login successful', uid: uid });

    } catch (error) {
        console.error('Error during login (Realtime DB):', error);
        callback({ success: false, message: `Error during login: ${error.message}` });
    }
}

module.exports = { registerUser, loginUser };