#!/usr/bin/env python3
"""Seed E2E test user with poweruser status."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))

from app.db.session import SessionLocal
from app.db.models.users import User, UserProfile
from app.services.auth import get_password_hash

USERNAME = "e2e-test-user"
PASSWORD = "Test1234!"


def main():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == USERNAME).first()
        if not user:
            user = User(
                username=USERNAME,
                password_hash=get_password_hash(PASSWORD),
            )
            db.add(user)
            db.flush()

            profile = UserProfile(
                user_id=user.id,
                role_id=3,
                is_poweruser=True,
                isadmin=False,
                birth_year=1990,
                birth_country='DE',
                birth_region='DE-BY',
                birth_city='Munich',
            )
            db.add(profile)
            db.commit()
            print(f"Created E2E test user: {USERNAME}")
        else:
            profile = db.query(UserProfile).filter(
                UserProfile.user_id == user.id
            ).first()
            if profile and not profile.is_poweruser:
                profile.is_poweruser = True
                db.commit()
                print(f"Granted poweruser to existing E2E test user: {USERNAME}")
            else:
                print(f"E2E test user already exists with poweruser: {USERNAME}")

            if profile and not profile.birth_year:
                profile.birth_year = 1990
                profile.birth_country = 'DE'
                profile.birth_region = 'DE-BY'
                profile.birth_city = 'Munich'
                db.commit()
                print(f"Added birth data to existing E2E test user: {USERNAME}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
