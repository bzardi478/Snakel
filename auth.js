// auth.js

const bcrypt = require('bcrypt');
const admin = require('firebase-admin');
module.exports = {
    registerUser: async function (admin, Email, password, callback) {
        const firestore = admin.firestore(); // Ensure you're using the passed 'admin' object
        console.log('registerUser called with:', Email, password);
        try {
            console.log('TRY BLOCK START');
            console.log('Hashing password...');
            const hashedPassword = await bcrypt.hash(password, 10);
            console.log('Password hashed:', hashedPassword);
            console.log('Checking if username exists:', Email);
            const userDoc = await firestore.collection('users').doc(Email).get();
            console.log('Username check result:', userDoc.exists);
            if (userDoc.exists) {
                console.log('Username already registered - sending error.');
                return callback({ success: false, error: 'Username already registered' });
            }
            console.log('Storing user data:', Email);
            await firestore.collection('users').doc(Email).set({
                password: hashedPassword,
            });
            console.log('User data stored successfully - sending success.');
            callback({ success: true, userId: Email });
            console.log('TRY BLOCK END - SUCCESS');
        } catch (error) {
            console.error('CATCH BLOCK ENTERED - Error registering user:', error);
            console.error(error);
            callback({ success: false, error: 'Registration failed' });
            console.log('CATCH BLOCK END');
        } finally {
            console.log('registerUser finished.');
        }
    },

    loginUser: async function (admin, Email, password, callback) {
        const firestore = admin.firestore(); // Ensure you're using the passed 'admin' object
        try {
            const userDoc = await firestore.collection('users').doc(Email).get();
            const userData = userDoc.data();

            if (!userData) {
                return callback({ success: false, error: 'Invalid username or password' });
            }

            const passwordMatch = await bcrypt.compare(password, userData.password);

            if (!passwordMatch) {
                return callback({ success: false, error: 'Invalid username or password' });
            }

            callback({ success: true, userId: Email });
        } catch (error) {
            console.error('Error logging in user:', error);
            callback({ success: false, error: 'Login failed' });
        } finally {
            console.log('loginUser finished.');
        }
    }
};