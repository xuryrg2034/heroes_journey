using System;
using Core.Entities;
using DG.Tweening;
using Services.Selection;

namespace Abilities.HeroAbilities
{
    public class JumpAttack : BaseAbility
    {
        private Hero _hero;
        private Entity _selectTarget;
        
        public override string Title { get; } = "Jump";

        public JumpAttack(Hero hero)
        {
            _hero = hero;
        }
        
        public override void Activate()
        {
            EntityClickHandler.OnEntityClicked += HandleClick;
        }

        public override void Deactivate()
        {
            EntityClickHandler.OnEntityClicked -= HandleClick;

            _resetSelection();
        }
        
        public override void HandleClick(Entity entity)
        {
            if (entity == _hero)
            {
                _resetSelection();
                return;
            }

            _selectEnemy(entity);
        }

        public override Tween Execute()
        {
            if (_selectTarget == null) return default;

            return _hero.Move(_selectTarget.Cell)
                .OnComplete(() =>
                {
                    _selectTarget.Die();
                    
                    _resetSelection();
                });
        }
        
        public override void Interrupt()
        {
            throw new NotImplementedException();
        }

        private void _selectEnemy(Entity entity)
        {
            _resetSelection();

            _selectTarget = entity;
            _highlightEnemy(entity, true);
        }

        private void _resetSelection()
        {
            if (_selectTarget == null) return;

            _highlightEnemy(_selectTarget, false);
            _selectTarget = null;
        }
    }
}