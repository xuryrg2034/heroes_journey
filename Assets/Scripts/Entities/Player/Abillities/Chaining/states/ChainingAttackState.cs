using System.Collections.Generic;
using Core;
using Cysharp.Threading.Tasks;
using Interfaces;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingBaseAttackState : State
    {
        ChainingAbility _ability;
        Hero _owner;
        int _animationDirection;
        int _nextIndex;
        int _damage;
        bool _isHit;
        bool _isEnd;
        readonly string _animationName = "Attack";
        float _minAnimationTrigger = 0.95f;

        public ChainingBaseAttackState(ChainingAbility ability, Hero owner)
        {
            _ability = ability;
            _owner = owner;
        }
        
        Animator Animator => _owner.Animator; 

        List<IBaseEntity> SelectedEntities => _ability.SelectedEntities;
        
        public override void OnEnter(StateMachine _stateMachine)
        {
            base.OnEnter(_stateMachine);

            AnimationStart();
        }
        
        public override void OnUpdate()
        {
            base.OnUpdate();

            TryToAttack();
            TryToEnd().Forget();
        }
        
        public override void OnExit()
        {
            base.OnExit();

            _nextIndex = 0;
            _isHit = false;
            _isEnd = false;
            _damage = 0;
            _animationDirection = -1;
            _ability.ResetSelection();
        }

        void TryToAttack()
        {
            var attackTrigger = Animator.GetFloat("Attack.Hit");

            if (attackTrigger >= _minAnimationTrigger && !_isHit)
            {
                var direction = AttackDirection(_animationDirection);

                if (direction == Vector3Int.zero)
                {
                    Debug.LogWarning("Не найдена анимация");

                    stateMachine.SetNextStateToMain();

                    return;
                }
                
                _isHit = true;
                _ability.Attack(direction, _damage);
            }
        }

        async UniTask TryToEnd()
        {
            var endTrigger = Animator.GetFloat("Attack.End");
            
            if (endTrigger >= _minAnimationTrigger && !_isEnd)
            {
                _isEnd = true;
                
                var entity = SelectedEntities[_nextIndex];
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
            
                if (_nextIndex >= SelectedEntities.Count)
                {
                    stateMachine.SetNextStateToMain();
                }
                else
                {
                    AnimationStart();
                }
            }
        }

        void AnimationStart()
        {
            var entity = SelectedEntities[_nextIndex];
            _animationDirection = NextAnimationDirection(entity.GridPosition);

            Animator.SetTrigger($"{_animationName}{_animationDirection}");
            
            _isEnd = false;
            _isHit = false;
        }

        int NextAnimationDirection(Vector3Int entityPosition)
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

        Vector3Int AttackDirection(int attackNumber)
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