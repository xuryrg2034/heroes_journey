using System;
using System.Collections.Generic;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Services.Grid;
using Services.Selection;
using UnityEngine;
using UnityEngine.Serialization;

namespace Abilities.Hero
{
    [Serializable]
    public class JumpAttack : BaseAbility
    {
        [SerializeField] private int damage;

        private Entity _selectTarget;
        
        public override void Activate()
        {
            base.Activate();

            EntityClickHandler.OnEntityClicked += SelectTarget;
        }

        public override void Deactivate()
        {
            base.Deactivate();
            
            EntityClickHandler.OnEntityClicked -= SelectTarget;

            _resetSelection();
        }
        
        public override void SelectTarget(Entity entity)
        {
            if (entity == Hero)
            {
                _resetSelection();
                return;
            }

            _resetSelection();

            if (entity.Health.Value - damage > 0) return;
            
            _selectTarget = entity;
            _highlightTarget(entity.Cell, true);
        }

        public override async UniTask Execute()
        {
            await base.Execute();

            
            await Hero.Move(_selectTarget.Cell, 0.1f);
            await _selectTarget.Health.TakeDamage(damage);
            
            _resetSelection();
        }
        
        public override void Cancel()
        {
            // throw new NotImplementedException();
        }

        private void _resetSelection()
        {
            if (_selectTarget == null) return;

            _highlightTarget(_selectTarget.Cell, false);
            _selectTarget = null;
        }
    }
}