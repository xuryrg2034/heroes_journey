using System.Linq;
using Core.Entities;
using DG.Tweening;
using Grid;
using Unity.VisualScripting;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    public class MassAttackAbilityComponent : BaseAbility
    {
        private Enemy _self;
        
        private void Start()
        {
            _self = GetComponent<Enemy>();
        }

        public override Tween Execute()
        {
            var notEmptyCells = _self.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();
            var entityList = notEmptyCells.Select(cell => cell.GetEntity()).Where(entity => entity).ToList();
            var sequence = DOTween.Sequence(null);

            foreach (var entity in entityList)
            {
                
                var tween = entity.TakeDamage(_self.AttackDamage);

                sequence.Join(tween);
            }

            return sequence;
        }
    }
}