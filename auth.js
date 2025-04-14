// auth.js

const bcrypt = require('bcrypt');
const admin = require('firebase-admin');

module.exports = {
    registerUser: async function (admin, email, password, callback) {
        const firestore = admin.firestore();
        console.log('registerUser called with:', email, password);
        try {
            console.log('TRY BLOCK START');
            console.log('Hashing password...');
            const hashedPassword = await bcrypt.hash(password, 10);
            console.log('Password hashed:', hashedPassword);
            console.log('Checking if email exists:', email);
            const userDoc = await firestore.collection('users').doc(email).get();
            console.log('Username check result:', userDoc.exists);
            if (userDoc.exists) {
                console.log('FAILURE POINT: Email already registered - sending error.');
                return callback({ success: false, error: 'Email already registered' });
            }
            console.log('Storing user data:', email);
            await firestore.collection('users').doc(email).set({
                password: hashedPassword,
            });
            console.log('SUCCESS POINT: User data stored successfully - sending success.');
            callback({ success: true, userId: email });
            console.log('TRY BLOCK END - SUCCESS');
        } catch (error) {
            console.error('FAILURE POINT: Error registering user - CATCH BLOCK ENTERED:', error);
            console.error(error);
            callback({ success: false, error: 'Registration failed' });
            console.log('CATCH BLOCK END');
        } finally {
            console.log('registerUser finished.');
        }
    },

    loginUser: async function (admin, email, password, callback) {
        const firestore = admin.firestore();
        try {
            const userDoc = await firestore.collection('users').doc(email).get();
            const userData = userDoc.data();

            if (!userData) {
                console.log('FAILURE POINT: Invalid email - user not found.');
                return callback({ success: false, error: 'Invalid email or password' });
            }

            const passwordMatch = await bcrypt.compare(password, userData.password);

            if (!passwordMatch) {
                console.log('FAILURE POINT: Invalid password.');
                return callback({ success: false, error: 'Invalid email or password' });
            }

            console.log('SUCCESS POINT: Login successful.');
            callback({ success: true, userId: email });
        } catch (error) {
            console.error('FAILURE POINT: Error logging in user - CATCH BLOCK ENTERED:', error);
            console.error(error);
            callback({ success: false, error: 'Login failed' });
        } finally {
            console.log('loginUser finished.');
        }
    }
};