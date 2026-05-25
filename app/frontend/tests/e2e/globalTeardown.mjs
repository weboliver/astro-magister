import { execSync } from 'child_process';

export default async function () {
  try {
    execSync(
      `docker exec astronex-api python -c "
import sys
sys.path.insert(0, '/workspace/app')
from sqlalchemy import text
from db.models.users import User, UserPerson, UserProfile, RefreshToken, AuthAuditLog
from db.session import SessionLocal
db = SessionLocal()
try:
    # 1. Clean persons for e2e-test-user
    test_user = db.query(User).filter(User.username == 'e2e-test-user').first()
    if test_user:
        db.query(UserPerson).filter(UserPerson.user_id == test_user.id).delete()
    
    # 2. Clean ephemeral e2e-* users (but not the permanent e2e-test-user)
    users = db.query(User).filter(
        User.username.like('e2e-%'),
        User.username != 'e2e-test-user'
    ).all()
    
    for u in users:
        # Delete related records before the user itself (FK ordering)
        db.query(AuthAuditLog).filter(AuthAuditLog.user_id == u.id).delete()
        db.query(RefreshToken).filter(RefreshToken.user_id == u.id).delete()
        db.execute(text('DELETE FROM user_interpretations WHERE user_id = :uid'), {'uid': u.id})
        db.query(UserPerson).filter(UserPerson.user_id == u.id).delete()
        db.query(UserProfile).filter(UserProfile.user_id == u.id).delete()
        db.delete(u)
    
    db.commit()
    print(f'Teardown complete: {len(users)} users cleaned')
except Exception as e:
    db.rollback()
    print(f'Teardown error: {e}')
finally:
    db.close()
" 2>&1`,
      { stdio: 'inherit', timeout: 30000 }
    );
  } catch (err) {
    console.warn('globalTeardown: cleanup failed (non-fatal):', err.message);
  }
}
