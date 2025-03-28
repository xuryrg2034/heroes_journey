using System.Collections.Generic;
using Core;
using Cysharp.Threading.Tasks;
using UnityEngine;
namespace Entities.Player.Slash
{
    public class SlashAttackState : State
    {
        readonly SlashAbility _ability;

        readonly Hero _owner;
        
        readonly int _hitTrigger = Animator.StringToHash("Attack.Hit");

        readonly int _endTrigger = Animator.StringToHash("Attack.End");
        
        readonly int _slashAttack = Animator.StringToHash("Slash_Attack");

        readonly float _minAnimationTrigger = 0.95f;
        
        bool _isHit;
       
        bool _isEnd;
        
        public SlashAttackState(SlashAbility ability, Hero owner)
        {
            _ability = ability;
            _owner = owner;
        }

        Animator Animator => _owner.Animator;
        
        public override void OnEnter(StateMachine _stateMachine)
        {
            base.OnEnter(_stateMachine);

            AnimationStart();
        }

        public override void OnUpdate()
        {
            base.OnUpdate();

            TryToAttack();
            TryToEnd();
        }
        
        void AnimationStart()
        {
            // TODO: Надо добавить направление анимации
            Animator.SetTrigger(_slashAttack);
            
            _isEnd = false;
            _isHit = false;
        }
        
        void TryToAttack()
        {
            var attackTrigger = Animator.GetFloat(_hitTrigger);

            if (attackTrigger >= _minAnimationTrigger && !_isHit)
            {
                _isHit = true;
                
                _ability.Attack();
            }
        }

        void TryToEnd()
        {
            var endTrigger = Animator.GetFloat(_endTrigger);
            
            if (endTrigger >= _minAnimationTrigger && !_isEnd)
            {
                _isEnd = true;
                
                stateMachine.SetNextStateToMain();
            }
        }

        public override void OnExit()
        {
            base.OnExit();
            
            _isHit = false;
            _isEnd = false;
        }
    }
}
