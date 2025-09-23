"""
User management routes for Supabase integration
"""
from flask import Blueprint, request, jsonify
from app.services.user_service import UserService
import logging

logger = logging.getLogger(__name__)

user_bp = Blueprint('user', __name__, url_prefix='/api/users')
user_service = UserService()

@user_bp.route('/sync', methods=['POST'])
async def sync_user():
    """Sync user data from Clerk to Supabase"""
    try:
        data = request.get_json()
        
        if not data or 'clerk_user_data' not in data:
            return jsonify({'error': 'Missing clerk_user_data'}), 400
        
        clerk_user_data = data['clerk_user_data']
        result = await user_service.sync_user_from_clerk(clerk_user_data)
        
        if result:
            return jsonify({'success': True, 'user': result}), 200
        else:
            return jsonify({'error': 'Failed to sync user'}), 500
            
    except Exception as e:
        logger.error(f"Error syncing user: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@user_bp.route('/<clerk_user_id>', methods=['GET'])
async def get_user(clerk_user_id):
    """Get user by Clerk user ID"""
    try:
        user = await user_service.get_user_by_clerk_id(clerk_user_id)
        
        if user:
            return jsonify({'success': True, 'user': user}), 200
        else:
            return jsonify({'error': 'User not found'}), 404
            
    except Exception as e:
        logger.error(f"Error getting user: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@user_bp.route('/<clerk_user_id>', methods=['PUT'])
async def update_user(clerk_user_id):
    """Update user data"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Missing update data'}), 400
        
        result = await user_service.update_user(clerk_user_id, data)
        
        if result:
            return jsonify({'success': True, 'user': result}), 200
        else:
            return jsonify({'error': 'Failed to update user'}), 500
            
    except Exception as e:
        logger.error(f"Error updating user: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@user_bp.route('/<clerk_user_id>', methods=['DELETE'])
async def delete_user(clerk_user_id):
    """Delete user by Clerk user ID"""
    try:
        success = await user_service.delete_user(clerk_user_id)
        
        if success:
            return jsonify({'success': True}), 200
        else:
            return jsonify({'error': 'Failed to delete user'}), 500
            
    except Exception as e:
        logger.error(f"Error deleting user: {e}")
        return jsonify({'error': 'Internal server error'}), 500
