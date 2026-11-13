const mongoose = require('mongoose');

const mongoUri = process.env.MONGODB_URI;
const applyChanges = process.argv.includes('--apply');
const backupConfirmed = process.env.DATABASE_BACKUP_CONFIRMED === 'yes';

if (!mongoUri) {
    console.error('Set MONGODB_URI to the intended database before running this script.');
    process.exit(1);
}

if (applyChanges && !backupConfirmed) {
    console.error('Create and verify a database backup first, then set DATABASE_BACKUP_CONFIRMED=yes.');
    process.exit(1);
}

async function main() {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const users = mongoose.connection.collection('users');
    const filter = {
        $or: [
            { 'goalSettings.token': { $exists: true } },
            { 'alertSettings.token': { $exists: true } },
            { 'topDonorSettings.token': { $exists: true } }
        ]
    };

    if (!applyChanges) {
        const count = await users.countDocuments(filter);
        console.log(`Dry run: ${count} user document(s) contain a token in saved settings.`);
        console.log('No database changes made. Add --apply after verifying a backup to remove those fields.');
        return;
    }

    const result = await users.updateMany(filter, {
        $unset: {
            'goalSettings.token': '',
            'alertSettings.token': '',
            'topDonorSettings.token': ''
        }
    });
    console.log(`Removed legacy setting tokens from ${result.modifiedCount} user document(s).`);
}

main()
    .catch(error => {
        console.error('Token scrub failed:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
