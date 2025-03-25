using System.Collections.Generic;
using Core;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingBaseAttackState : State
    {
        private ChainingAbility _ability;
        private List<BaseEntity> _selectedEntities;
        private Hero _owner;
        private Animator _animator;
        private readonly string _animationName = "Attack";
        private int _animationDirection;
        private int _nextIndex;
        private int _damage;
        private bool _isHit;
        private bool _isEnd;

        public ChainingBaseAttackState(ChainingAbility ability, Hero owner)
        {
            _ability = ability;
            _owner = owner;

            _selectedEntities = _ability.SelectedEntities;
            _animator = _owner.Animator;
        }
        public override void OnEnter(StateMachine _stateMachine)
        {
            base.OnEnter(_stateMachine);

            _animationStart();
        }
        
        public override void OnUpdate()
        {
            base.OnUpdate();

            if (_animator.GetFloat("Attack.Hit") >= 1f && !_isHit)
            {
                _isHit = true;

                var direction = _attackDirection(_animationDirection);

                if (direction == Vector3Int.zero)
                {
                    Debug.LogWarning("Не найдена анимация");

                    stateMachine.SetNextStateToMain();

                    return;
                }
                
                _ability.Attack(direction, _damage);
            }
            
            if (_animator.GetFloat("Attack.End") >= 1f && !_isEnd)
            {
                _isEnd = true;
                _animationEnd().Forget();
            }
        }
        
        public override void OnExit()
        {
            base.OnExit();

            _nextIndex = 0;
        }

        private void _animationStart()
        {
            var entity = _selectedEntities[_nextIndex];
            _animationDirection = _nextAnimationDirection(entity.GridPosition);
            

            _animator.SetTrigger($"{_animationName}{_animationDirection}");
            
            _isEnd = false;
            _isHit = false;
        }

        private async UniTask _animationEnd()
        {
            var entity = _selectedEntities[_nextIndex];
            var entityHealth = entity.Health.Value;

            if (entityHealth == 0)
            {
                _damage += 1;
            }
            
            _damage -= entityHealth;
            
            if (entity.Health.IsDead)
            {
                await _owner.Move(entity.GridPosition, 0.1f);

                _nextIndex++;
            }
            
            if (_nextIndex >= _selectedEntities.Count)
            {
                stateMachine.SetNextStateToMain();
            }
            else
            {
                _animationStart();
            }
        }
        
        private int _nextAnimationDirection(Vector3Int entityPosition)
        {
            var start = _ability.OriginGridPosition;
            var delta = entityPosition - start;

            if (Mathf.Abs(delta.x) > Mathf.Abs(delta.y))
            {
                // Right / Left
                return delta.x > 0 ? 1 : 3;
            }
            else
            {
                // Top / Down
                return delta.y > 0 ? 0 : 2;
            }
        }

        private Vector3Int _attackDirection(int attackNumber)
        {
            return attackNumber switch
            {
                0 => Vector3Int.up,
                1 => Vector3Int.right,
                2 => Vector3Int.down,
                3 => Vector3Int.left,
                _ => Vector3Int.zero
            };
        }
    }
}